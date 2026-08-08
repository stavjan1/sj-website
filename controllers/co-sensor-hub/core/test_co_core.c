/* Self-checking test bench for co_core. Build: see build.sh */
#include "co_core.h"

#include <stdio.h>
#include <string.h>

static int failures = 0;
static int checks   = 0;

#define CHECK(cond, ...)                                                 \
    do {                                                                 \
        checks++;                                                        \
        if (!(cond)) {                                                   \
            failures++;                                                  \
            printf("  FAIL  ");                                          \
            printf(__VA_ARGS__);                                         \
            printf("\n");                                                \
        }                                                                \
    } while (0)

/* --- tiny simulation harness ----------------------------------------- */

typedef struct {
    co_zone_t      zone;
    co_sensor_in_t sensors[CO_MAX_SENSORS];
    uint8_t        n;
    uint32_t       now_ms;
    co_output_t    out;
} sim_t;

static void sim_init(sim_t *s, uint8_t n, const co_config_t *cfg)
{
    memset(s, 0, sizeof(*s));
    s->n = n;
    co_zone_init(&s->zone, cfg, n);
    for (uint8_t i = 0; i < n; i++) {
        s->sensors[i].ppm   = 0.0f;
        s->sensors[i].fault = CO_SENSOR_OK;
    }
}

static void sim_set_all(sim_t *s, float ppm)
{
    for (uint8_t i = 0; i < s->n; i++) s->sensors[i].ppm = ppm;
}

/* Run for `seconds`, ticking once per second. */
static void sim_run(sim_t *s, uint32_t seconds)
{
    for (uint32_t i = 0; i < seconds; i++) {
        co_zone_tick(&s->zone, s->sensors, s->now_ms, &s->out);
        s->now_ms += 1000u;
    }
}

static const char *stage_name(co_stage_t st)
{
    switch (st) {
    case CO_STAGE_IDLE:      return "IDLE";
    case CO_STAGE_1:         return "STAGE_1";
    case CO_STAGE_2:         return "STAGE_2";
    case CO_STAGE_3:         return "STAGE_3";
    case CO_STAGE_EMERGENCY: return "EMERGENCY";
    default:                 return "?";
    }
}

/* --- tests ------------------------------------------------------------ */

static void t_idle_stays_idle(void)
{
    printf("clean air stays idle\n");
    co_config_t cfg; co_config_defaults(&cfg);
    sim_t s; sim_init(&s, 4, &cfg);

    sim_set_all(&s, 10.0f);
    sim_run(&s, 20 * 60);

    CHECK(s.out.stage == CO_STAGE_IDLE, "expected IDLE, got %s", stage_name(s.out.stage));
    CHECK(s.out.demand_pct == 0, "expected 0%% demand, got %u", s.out.demand_pct);
    CHECK(!s.out.compliance_breach, "10 ppm must not breach the 30 ppm/30 min limit");
}

static void t_stage1_needs_the_full_delay(void)
{
    printf("35 ppm: nothing at 4 min, stage 1 at 5 min\n");
    co_config_t cfg; co_config_defaults(&cfg);
    sim_t s; sim_init(&s, 4, &cfg);

    sim_set_all(&s, 35.0f);
    sim_run(&s, 4 * 60);
    CHECK(s.out.stage == CO_STAGE_IDLE, "too early: got %s", stage_name(s.out.stage));

    sim_run(&s, 2 * 60);
    CHECK(s.out.stage == CO_STAGE_1, "expected STAGE_1, got %s", stage_name(s.out.stage));
    CHECK(s.out.demand_pct == 50, "expected 50%% demand, got %u", s.out.demand_pct);
    CHECK(!s.out.alarm, "stage 1 must not raise an alarm");
}

static void t_escalation_to_stage2(void)
{
    printf("70 ppm escalates to stage 2\n");
    co_config_t cfg; co_config_defaults(&cfg);
    sim_t s; sim_init(&s, 4, &cfg);

    sim_set_all(&s, 70.0f);
    sim_run(&s, 5 * 60 + 5);
    CHECK(s.out.stage == CO_STAGE_2, "expected STAGE_2, got %s", stage_name(s.out.stage));
    CHECK(s.out.demand_pct == 75, "expected 75%% demand, got %u", s.out.demand_pct);
}

static void t_alarm_on_one_sensor(void)
{
    printf("a single sensor at 130 ppm still triggers the alarm (max-select)\n");
    co_config_t cfg; co_config_defaults(&cfg);
    sim_t s; sim_init(&s, 4, &cfg);

    sim_set_all(&s, 10.0f);
    s.sensors[2].ppm = 130.0f;
    sim_run(&s, 40);

    CHECK(s.out.stage == CO_STAGE_3, "expected STAGE_3, got %s", stage_name(s.out.stage));
    CHECK(s.out.alarm, "stage 3 must raise the alarm");
    CHECK(s.out.demand_pct == 100, "expected full demand, got %u", s.out.demand_pct);
}

static void t_evacuation_needs_quorum(void)
{
    printf("evacuation needs a quorum; ventilation does not\n");
    co_config_t cfg; co_config_defaults(&cfg);
    sim_t s; sim_init(&s, 4, &cfg);

    /* One sensor screaming: ventilate at full, but do not evacuate. */
    sim_set_all(&s, 10.0f);
    s.sensors[0].ppm = 250.0f;
    sim_run(&s, 10);
    CHECK(s.out.stage == CO_STAGE_EMERGENCY, "expected EMERGENCY, got %s", stage_name(s.out.stage));
    CHECK(s.out.demand_pct == 100, "must ventilate at full");
    CHECK(!s.out.evacuate, "one sensor must not order an evacuation");
    CHECK(s.out.rogue_mask != 0, "the lone high sensor should be flagged as rogue");

    /* Three agree: evacuate. */
    sim_set_all(&s, 250.0f);
    sim_run(&s, 5);
    CHECK(s.out.evacuate, "3+ sensors agreeing must order an evacuation");

    /* Latched: clean air alone does not clear it. */
    sim_set_all(&s, 5.0f);
    sim_run(&s, 30 * 60);
    CHECK(s.out.stage == CO_STAGE_EMERGENCY, "emergency must latch until reset");
    co_zone_reset_latch(&s.zone);
    sim_run(&s, 60 * 60);
    CHECK(s.out.stage == CO_STAGE_IDLE, "after reset + clean air, expected IDLE, got %s",
          stage_name(s.out.stage));
}

static void t_min_run_and_hysteresis(void)
{
    printf("fan keeps running for min_run after the air clears\n");
    co_config_t cfg; co_config_defaults(&cfg);
    sim_t s; sim_init(&s, 4, &cfg);

    sim_set_all(&s, 35.0f);
    sim_run(&s, 5 * 60 + 5);
    CHECK(s.out.stage == CO_STAGE_1, "setup: expected STAGE_1, got %s", stage_name(s.out.stage));

    sim_set_all(&s, 0.0f);
    sim_run(&s, 9 * 60);
    CHECK(s.out.stage == CO_STAGE_1, "must hold for min_run (10 min), got %s",
          stage_name(s.out.stage));

    sim_run(&s, 2 * 60);
    CHECK(s.out.stage == CO_STAGE_IDLE, "after min_run expected IDLE, got %s",
          stage_name(s.out.stage));
}

static void t_hysteresis_band(void)
{
    printf("26 ppm does not step stage 1 down (hysteresis band is 24-30)\n");
    co_config_t cfg; co_config_defaults(&cfg);
    sim_t s; sim_init(&s, 4, &cfg);

    sim_set_all(&s, 35.0f);
    sim_run(&s, 5 * 60 + 5);

    sim_set_all(&s, 26.0f);          /* below 30 but above 30*0.8 = 24     */
    sim_run(&s, 30 * 60);
    CHECK(s.out.stage == CO_STAGE_1, "26 ppm must stay in STAGE_1, got %s",
          stage_name(s.out.stage));

    sim_set_all(&s, 20.0f);          /* below the band                      */
    sim_run(&s, 11 * 60);
    CHECK(s.out.stage == CO_STAGE_IDLE, "20 ppm must release to IDLE, got %s",
          stage_name(s.out.stage));
}

static void t_failsafe_on_total_sensor_loss(void)
{
    printf("all sensors dead -> fans run, fault raised\n");
    co_config_t cfg; co_config_defaults(&cfg);
    sim_t s; sim_init(&s, 4, &cfg);

    for (uint8_t i = 0; i < s.n; i++) s.sensors[i].fault = CO_SENSOR_OPEN_LOOP;
    sim_run(&s, 60);

    CHECK(s.out.failsafe_active, "failsafe must engage");
    CHECK(s.out.fault, "fault must be raised");
    CHECK(s.out.demand_pct == 100, "failsafe demand expected 100, got %u", s.out.demand_pct);
    CHECK(s.out.fault_mask == 0x0F, "all four sensors should be in the fault mask, got 0x%X",
          s.out.fault_mask);
}

static void t_partial_sensor_loss_still_controls(void)
{
    printf("some sensors dead -> the survivors still control\n");
    co_config_t cfg; co_config_defaults(&cfg);
    sim_t s; sim_init(&s, 4, &cfg);

    s.sensors[0].fault = CO_SENSOR_NO_COMMS;
    s.sensors[1].fault = CO_SENSOR_OPEN_LOOP;
    s.sensors[2].ppm   = 70.0f;
    s.sensors[3].ppm   = 65.0f;
    sim_run(&s, 5 * 60 + 5);

    CHECK(!s.out.failsafe_active, "two healthy sensors is not a failsafe condition");
    CHECK(s.out.fault, "the two dead sensors must still raise a fault");
    CHECK(s.out.stage == CO_STAGE_2, "expected STAGE_2 from the survivors, got %s",
          stage_name(s.out.stage));
}

static void t_calibration_expiry_keeps_reading(void)
{
    printf("expired calibration: keep the reading, raise the fault\n");
    co_config_t cfg; co_config_defaults(&cfg);
    sim_t s; sim_init(&s, 4, &cfg);

    sim_set_all(&s, 70.0f);
    s.sensors[1].fault = CO_SENSOR_CAL_EXPIRED;
    sim_run(&s, 5 * 60 + 5);

    CHECK(s.out.stage == CO_STAGE_2, "expected STAGE_2, got %s", stage_name(s.out.stage));
    CHECK(s.out.fault, "expired calibration must raise a fault");
    CHECK((s.out.fault_mask & 0x02) != 0, "sensor 1 should be flagged");
}

static void t_compliance_average(void)
{
    printf("35 ppm sustained breaches the 30 ppm / 30 min limit\n");
    co_config_t cfg; co_config_defaults(&cfg);
    sim_t s; sim_init(&s, 4, &cfg);

    sim_set_all(&s, 35.0f);
    sim_run(&s, 35 * 60);

    CHECK(s.out.avg_30min_ppm > 34.0f && s.out.avg_30min_ppm < 36.0f,
          "expected ~35 ppm average, got %.1f", (double)s.out.avg_30min_ppm);
    CHECK(s.out.compliance_breach, "35 ppm sustained must flag a compliance breach");
}

static void t_shared_smoke_fan_is_capped(void)
{
    printf("shared smoke fan: CO control never reaches high speed\n");
    co_config_t cfg; co_config_defaults(&cfg);
    cfg.smoke_fan_shared  = true;
    cfg.smoke_fan_cap_pct = 50;
    sim_t s; sim_init(&s, 4, &cfg);

    sim_set_all(&s, 250.0f);
    sim_run(&s, 10);

    CHECK(s.out.stage == CO_STAGE_EMERGENCY, "expected EMERGENCY, got %s",
          stage_name(s.out.stage));
    CHECK(s.out.demand_pct == 50, "demand must be capped at 50, got %u", s.out.demand_pct);
    CHECK(s.out.alarm, "the alarm still fires even though the fan is capped");
}

static void t_fan_profiles(void)
{
    printf("one demand figure drives every fan type\n");
    co_fan_out_t o;

    co_fan_cfg_t single = { CO_FAN_SINGLE_SPEED, 0 };
    co_fan_apply(&single, 0,  &o); CHECK(!o.running, "single: 0%% must be off");
    co_fan_apply(&single, 40, &o); CHECK(o.relay[0] && o.running, "single: 40%% must be on");
    co_fan_apply(&single, 100,&o); CHECK(o.relay[0] && !o.relay[1], "single: only one tap");

    co_fan_cfg_t two = { CO_FAN_TWO_SPEED, 0 };
    co_fan_apply(&two, 50, &o);
    CHECK(o.relay[0] && !o.relay[1], "two-speed: 50%% -> low tap only");
    co_fan_apply(&two, 75, &o);
    CHECK(!o.relay[0] && o.relay[1], "two-speed: 75%% -> high tap only");

    co_fan_cfg_t three = { CO_FAN_THREE_SPEED, 0 };
    co_fan_apply(&three, 30,  &o); CHECK(o.relay[0] && !o.relay[1] && !o.relay[2], "3sp: low");
    co_fan_apply(&three, 50,  &o); CHECK(!o.relay[0] && o.relay[1] && !o.relay[2], "3sp: mid");
    co_fan_apply(&three, 100, &o); CHECK(!o.relay[0] && !o.relay[1] && o.relay[2], "3sp: high");

    co_fan_cfg_t vfd = { CO_FAN_VFD, 30 };
    co_fan_apply(&vfd, 0,  &o); CHECK(o.vfd_pct == 0 && !o.running, "vfd: 0%% off");
    co_fan_apply(&vfd, 10, &o); CHECK(o.vfd_pct == 30, "vfd: must clamp to the 30%% minimum, got %u", o.vfd_pct);
    co_fan_apply(&vfd, 75, &o); CHECK(o.vfd_pct == 75, "vfd: 75%% passes through, got %u", o.vfd_pct);
}

int main(void)
{
    printf("co_core test bench\n==================\n");

    t_idle_stays_idle();
    t_stage1_needs_the_full_delay();
    t_escalation_to_stage2();
    t_alarm_on_one_sensor();
    t_evacuation_needs_quorum();
    t_min_run_and_hysteresis();
    t_hysteresis_band();
    t_failsafe_on_total_sensor_loss();
    t_partial_sensor_loss_still_controls();
    t_calibration_expiry_keeps_reading();
    t_compliance_average();
    t_shared_smoke_fan_is_capped();
    t_fan_profiles();

    printf("==================\n%d checks, %d failures\n", checks, failures);
    return failures ? 1 : 0;
}
