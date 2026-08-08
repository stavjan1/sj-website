#include "co_core.h"

#include <string.h>

#define MINUTES(x) ((uint32_t)(x) * 60000u)
#define SECONDS(x) ((uint32_t)(x) * 1000u)

/* Legal limit: 30 ppm averaged over 30 minutes. */
#define CO_COMPLIANCE_LIMIT_PPM 30.0f

void co_config_defaults(co_config_t *cfg)
{
    memset(cfg, 0, sizeof(*cfg));

    cfg->stage[CO_STAGE_IDLE]      = (co_stage_cfg_t){   0.0f, 0,            0 };
    cfg->stage[CO_STAGE_1]         = (co_stage_cfg_t){  30.0f, MINUTES(5),  50 };
    cfg->stage[CO_STAGE_2]         = (co_stage_cfg_t){  60.0f, MINUTES(2),  75 };
    cfg->stage[CO_STAGE_3]         = (co_stage_cfg_t){ 120.0f, SECONDS(30),100 };
    cfg->stage[CO_STAGE_EMERGENCY] = (co_stage_cfg_t){ 200.0f, 0,          100 };

    cfg->hysteresis_pct      = 0.20f;
    cfg->min_run_ms          = MINUTES(10);
    cfg->min_off_ms          = MINUTES(3);

    cfg->failsafe_demand_pct = 100;   /* lose the sensors -> ventilate      */
    cfg->quorum_for_evac     = 3;
    cfg->rogue_margin_ppm    = 40.0f;

    cfg->smoke_fan_shared    = false;
    cfg->smoke_fan_cap_pct   = 50;    /* high speed reserved for the fire system */
}

void co_zone_init(co_zone_t *z, const co_config_t *cfg, uint8_t sensor_count)
{
    memset(z, 0, sizeof(*z));
    z->cfg = *cfg;
    z->sensor_count = sensor_count > CO_MAX_SENSORS ? CO_MAX_SENSORS : sensor_count;
    z->stage = CO_STAGE_IDLE;
}

void co_zone_reset_latch(co_zone_t *z)
{
    z->emergency_latched = false;
}

/* ---------- internals ---------- */

static void buckets_push(co_zone_t *z, float ppm, uint32_t now_ms)
{
    while ((uint32_t)(now_ms - z->bucket_started_ms) >= MINUTES(1)) {
        z->bucket_started_ms += MINUTES(1);
        z->bucket_idx = (uint8_t)((z->bucket_idx + 1u) % CO_AVG_BUCKETS);
        z->buckets[z->bucket_idx].sum   = 0.0f;
        z->buckets[z->bucket_idx].count = 0;
    }
    z->buckets[z->bucket_idx].sum += ppm;
    z->buckets[z->bucket_idx].count++;
}

static float buckets_average(const co_zone_t *z)
{
    float    sum   = 0.0f;
    uint32_t count = 0;

    for (uint8_t i = 0; i < CO_AVG_BUCKETS; i++) {
        sum   += z->buckets[i].sum;
        count += z->buckets[i].count;
    }
    return count ? (sum / (float)count) : 0.0f;
}

static bool sensor_usable(const co_sensor_in_t *s)
{
    /* CAL_EXPIRED still reports a number: keep using it, but flag the fault.
       Everything else is untrustworthy. */
    return s->fault == CO_SENSOR_OK || s->fault == CO_SENSOR_CAL_EXPIRED;
}

void co_zone_tick(co_zone_t *z,
                  const co_sensor_in_t *sensors,
                  uint32_t now_ms,
                  co_output_t *out)
{
    const co_config_t *cfg = &z->cfg;

    if (!z->started) {
        z->started           = true;
        z->last_tick_ms      = now_ms;
        z->stage_since_ms    = now_ms;
        z->off_since_ms      = now_ms;
        z->bucket_started_ms = now_ms;
    }

    const uint32_t dt = (uint32_t)(now_ms - z->last_tick_ms);
    z->last_tick_ms = now_ms;

    memset(out, 0, sizeof(*out));

    /* --- 1. combine sensors: MAX-SELECT over the healthy ones ---------- */
    float   zone_ppm = 0.0f;
    float   second   = 0.0f;   /* highest reading excluding the top one     */
    uint8_t healthy  = 0;

    for (uint8_t i = 0; i < z->sensor_count; i++) {
        if (!sensor_usable(&sensors[i])) {
            out->fault_mask |= (uint16_t)(1u << i);
            out->fault = true;
            continue;
        }
        if (sensors[i].fault == CO_SENSOR_CAL_EXPIRED) {
            out->fault_mask |= (uint16_t)(1u << i);
            out->fault = true;
        }
        healthy++;
        if (sensors[i].ppm > zone_ppm) {
            second   = zone_ppm;
            zone_ppm = sensors[i].ppm;
        } else if (sensors[i].ppm > second) {
            second = sensors[i].ppm;
        }
    }

    out->failsafe_active = (healthy == 0);

    /* A sensor sitting far above every one of its peers is suspect, not an
       event. Flag it; never let it alone drive an evacuation. */
    if (healthy >= 3 && (zone_ppm - second) > cfg->rogue_margin_ppm) {
        for (uint8_t i = 0; i < z->sensor_count; i++) {
            if (sensor_usable(&sensors[i]) && sensors[i].ppm >= zone_ppm) {
                out->rogue_mask |= (uint16_t)(1u << i);
            }
        }
        out->fault = true;
    }

    /* --- 2. rolling 30-minute average (the regulatory figure) ---------- */
    if (!out->failsafe_active) {
        buckets_push(z, zone_ppm, now_ms);
    }
    out->avg_30min_ppm     = buckets_average(z);
    out->compliance_breach = out->avg_30min_ppm > CO_COMPLIANCE_LIMIT_PPM;

    /* --- 3. how long have we been above each threshold? ---------------- */
    for (int s = CO_STAGE_1; s < CO_STAGE_COUNT; s++) {
        if (!out->failsafe_active && zone_ppm >= cfg->stage[s].on_ppm) {
            z->above_ms[s] += dt;
        } else {
            z->above_ms[s] = 0;
        }
    }

    /* --- 4. target stage = highest one whose delay has elapsed --------- */
    co_stage_t target = CO_STAGE_IDLE;
    for (int s = CO_STAGE_1; s < CO_STAGE_COUNT; s++) {
        if (z->above_ms[s] >= cfg->stage[s].on_delay_ms &&
            !out->failsafe_active &&
            zone_ppm >= cfg->stage[s].on_ppm) {
            target = (co_stage_t)s;
        }
    }

    if (target == CO_STAGE_EMERGENCY) {
        z->emergency_latched = true;
    }
    if (z->emergency_latched) {
        target = CO_STAGE_EMERGENCY;   /* stays until reset_latch()        */
    }

    /* --- 5. step up freely, step down only under hysteresis + min_run -- */
    if (target > z->stage) {
        bool blocked_by_min_off = (z->stage == CO_STAGE_IDLE) &&
                                  ((uint32_t)(now_ms - z->off_since_ms) < cfg->min_off_ms) &&
                                  (target < CO_STAGE_3);   /* never hold back an alarm */
        if (!blocked_by_min_off) {
            z->stage          = target;
            z->stage_since_ms = now_ms;
        }
    } else if (target < z->stage) {
        const float drop_below = cfg->stage[z->stage].on_ppm * (1.0f - cfg->hysteresis_pct);
        const bool  ran_long_enough =
            (uint32_t)(now_ms - z->stage_since_ms) >= cfg->min_run_ms;

        if (zone_ppm < drop_below && ran_long_enough) {
            z->stage          = (co_stage_t)(z->stage - 1);
            z->stage_since_ms = now_ms;
            if (z->stage == CO_STAGE_IDLE) {
                z->off_since_ms = now_ms;
            }
        }
    }

    /* --- 6. demand ----------------------------------------------------- */
    uint8_t demand = cfg->stage[z->stage].demand_pct;

    if (out->failsafe_active && cfg->failsafe_demand_pct > demand) {
        demand = cfg->failsafe_demand_pct;
    }
    /* When the fan's high speed belongs to the smoke-extraction system, the
       CO controller must not reach for it. */
    if (cfg->smoke_fan_shared && demand > cfg->smoke_fan_cap_pct) {
        demand = cfg->smoke_fan_cap_pct;
    }

    /* --- 7. alarms ----------------------------------------------------- */
    out->stage      = z->stage;
    out->demand_pct = demand;
    out->zone_ppm   = zone_ppm;
    out->alarm      = (z->stage >= CO_STAGE_3);

    /* Fans follow max-select; evacuation needs agreement. */
    if (z->stage == CO_STAGE_EMERGENCY) {
        uint8_t agree = 0;
        for (uint8_t i = 0; i < z->sensor_count; i++) {
            if (sensor_usable(&sensors[i]) &&
                sensors[i].ppm >= cfg->stage[CO_STAGE_EMERGENCY].on_ppm) {
                agree++;
            }
        }
        uint8_t needed = cfg->quorum_for_evac;
        if (needed > healthy) {
            needed = healthy ? healthy : 1;   /* small zones can't out-vote  */
        }
        out->evacuate = (agree >= needed);
    }
}

/* ---------- fan driver ---------- */

void co_fan_apply(const co_fan_cfg_t *fan, uint8_t demand_pct, co_fan_out_t *out)
{
    memset(out, 0, sizeof(*out));

    if (demand_pct == 0) {
        return;
    }

    switch (fan->profile) {
    case CO_FAN_SINGLE_SPEED:
        out->relay[0] = true;
        break;

    case CO_FAN_TWO_SPEED:
        /* Taps are mutually exclusive — energising both destroys a Dahlander. */
        if (demand_pct <= 50) out->relay[0] = true;
        else                  out->relay[1] = true;
        break;

    case CO_FAN_THREE_SPEED:
        if      (demand_pct <= 33) out->relay[0] = true;
        else if (demand_pct <= 66) out->relay[1] = true;
        else                       out->relay[2] = true;
        break;

    case CO_FAN_VFD:
        out->vfd_pct = demand_pct < fan->vfd_min_pct ? fan->vfd_min_pct : demand_pct;
        break;
    }

    out->running = out->relay[0] || out->relay[1] || out->relay[2] || out->vfd_pct > 0;
}
