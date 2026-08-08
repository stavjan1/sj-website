/*
 * co_core — parking-garage CO ventilation control core.
 *
 * Pure C99. No malloc, no OS, no hardware. Feed it sensor readings and a
 * millisecond clock; it returns a ventilation demand of 0..100 % plus alarm
 * and fault state. Everything platform-specific (4-20mA, Modbus, relays,
 * VFD) lives outside this file.
 *
 * Standards this implements (see spec):
 *   - IL planning regulations / SI 1001 : <=30 ppm averaged over 30 min,
 *                                         never above ~200 ppm.
 *   - EN 50545-1                        : three alarm levels (30/60/150).
 *   - IMC 404                           : ventilation starts at 25 ppm.
 */
#ifndef CO_CORE_H
#define CO_CORE_H

#include <stdbool.h>
#include <stdint.h>

#define CO_MAX_SENSORS 16

/* ---------- sensor input ---------- */

typedef enum {
    CO_SENSOR_OK = 0,
    CO_SENSOR_OPEN_LOOP,      /* < 3.5 mA  — wire cut                       */
    CO_SENSOR_OVER_RANGE,     /* > 21 mA   — short / sensor failure         */
    CO_SENSOR_NO_COMMS,       /* Modbus watchdog expired                    */
    CO_SENSOR_CAL_EXPIRED,    /* calibration past due                       */
    CO_SENSOR_STUCK,          /* identical reading for an implausible time  */
    CO_SENSOR_DISABLED        /* not fitted / taken out of service          */
} co_sensor_fault_t;

typedef struct {
    float             ppm;    /* current reading, ppm                       */
    co_sensor_fault_t fault;
} co_sensor_in_t;

/* ---------- staging ---------- */

typedef enum {
    CO_STAGE_IDLE = 0,
    CO_STAGE_1,               /* low   — normal traffic                     */
    CO_STAGE_2,               /* high  — busy                               */
    CO_STAGE_3,               /* full  + alarm                              */
    CO_STAGE_EMERGENCY,       /* full  + evacuation, latched                */
    CO_STAGE_COUNT
} co_stage_t;

typedef struct {
    float    on_ppm;          /* threshold to enter this stage              */
    uint32_t on_delay_ms;     /* must stay above on_ppm this long           */
    uint8_t  demand_pct;      /* ventilation demand while in this stage     */
} co_stage_cfg_t;

/* ---------- configuration ---------- */

typedef struct {
    co_stage_cfg_t stage[CO_STAGE_COUNT];

    float    hysteresis_pct;      /* drop below on_ppm*(1-h) to step down   */
    uint32_t min_run_ms;          /* minimum time at a stage before stepping down */
    uint32_t min_off_ms;          /* minimum off time before restarting     */

    uint8_t  failsafe_demand_pct; /* demand when the zone loses its sensors */
    uint8_t  quorum_for_evac;     /* sensors that must agree to evacuate    */
    float    rogue_margin_ppm;    /* this far above its peers => rogue      */

    bool     smoke_fan_shared;    /* fan's high speed belongs to the fire
                                     system — cap CO demand below it        */
    uint8_t  smoke_fan_cap_pct;   /* cap applied when smoke_fan_shared      */
} co_config_t;

/* Israeli defaults, per the spec. */
void co_config_defaults(co_config_t *cfg);

/* ---------- output ---------- */

typedef struct {
    co_stage_t stage;
    uint8_t    demand_pct;        /* 0..100 — what the fan driver consumes  */

    float      zone_ppm;          /* max-select across healthy sensors      */
    float      avg_30min_ppm;     /* regulatory compliance figure           */

    bool       alarm;             /* stage 3+                               */
    bool       evacuate;          /* quorum agreed, or emergency threshold  */
    bool       fault;             /* any sensor fault / failsafe active     */
    bool       failsafe_active;   /* zone has no usable sensor              */
    bool       compliance_breach; /* 30-min average exceeded the legal limit*/

    uint16_t   rogue_mask;        /* bit per sensor reading far above peers */
    uint16_t   fault_mask;        /* bit per faulted sensor                 */
} co_output_t;

/* ---------- zone state (opaque-ish; allocate one per zone) ---------- */

#define CO_AVG_BUCKETS 30         /* 30 x 1-minute buckets = 30 min window  */

typedef struct {
    float    sum;
    uint32_t count;
} co_bucket_t;

typedef struct {
    co_config_t cfg;
    uint8_t     sensor_count;

    co_stage_t  stage;
    uint32_t    stage_since_ms;
    uint32_t    off_since_ms;
    bool        emergency_latched;

    uint32_t    above_ms[CO_STAGE_COUNT];  /* time spent above each threshold */

    co_bucket_t buckets[CO_AVG_BUCKETS];
    uint8_t     bucket_idx;
    uint32_t    bucket_started_ms;

    uint32_t    last_tick_ms;
    bool        started;
} co_zone_t;

void co_zone_init(co_zone_t *z, const co_config_t *cfg, uint8_t sensor_count);

/*
 * Call every control cycle (100 ms .. 1 s is fine; the core is time-driven,
 * not rate-driven). now_ms must be monotonic.
 */
void co_zone_tick(co_zone_t *z,
                  const co_sensor_in_t *sensors,
                  uint32_t now_ms,
                  co_output_t *out);

/* Clears a latched emergency once the air is clean again. */
void co_zone_reset_latch(co_zone_t *z);

/* ---------- fan driver: demand % -> what the fan can actually do ------- */

typedef enum {
    CO_FAN_SINGLE_SPEED = 0,  /* on / off                                   */
    CO_FAN_TWO_SPEED,         /* Dahlander or two windings                  */
    CO_FAN_THREE_SPEED,
    CO_FAN_VFD                /* continuous                                 */
} co_fan_profile_t;

typedef struct {
    co_fan_profile_t profile;
    uint8_t          vfd_min_pct;  /* below this a VFD loses motor cooling  */
} co_fan_cfg_t;

typedef struct {
    bool    relay[3];    /* speed taps; index 0 = slowest                   */
    uint8_t vfd_pct;     /* 0 or vfd_min_pct..100                           */
    bool    running;
} co_fan_out_t;

void co_fan_apply(const co_fan_cfg_t *fan, uint8_t demand_pct, co_fan_out_t *out);

#endif /* CO_CORE_H */
