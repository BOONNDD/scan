//+------------------------------------------------------------------+
//|                        SUPREME-EA v1.mq5                         |
//|  بوت التداول الذكي المتكامل — SUPREME-EA v1                      |
//|  المنصة: MetaTrader 5 | الوسيط: Exness Standard Cent            |
//|  الرمز: EURUSD | الإطار الزمني: M5                               |
//+------------------------------------------------------------------+
#property copyright  "SUPREME-EA v1"
#property version    "1.00"
#property description "30-Algo | TVE | Kalman | Hurst | SR Zones | Arabic Panel"

#include <Trade\Trade.mqh>

//+------------------------------------------------------------------+
//| الثوابت                                                          |
//+------------------------------------------------------------------+
#define SUPREME_MAGIC    20240101
#define TVE_BUF_SIZE     60
#define MAX_ZONES        10
#define TOTAL_ALGOS      32
#define PANEL_PREFIX     "SUP_"

// مؤشرات الخوارزميات
#define IDX_A1  0
#define IDX_A2  1
#define IDX_A3  2
#define IDX_B1  3
#define IDX_B2  4
#define IDX_B3  5
#define IDX_B4  6
#define IDX_B5  7
#define IDX_B6  8
#define IDX_B7  9
#define IDX_B8  10
#define IDX_C1  11
#define IDX_C2  12
#define IDX_C3  13
#define IDX_C4  14
#define IDX_C5  15
#define IDX_C6  16
#define IDX_D1  17  // D1..D15 → 17..31

//+------------------------------------------------------------------+
//| المدخلات                                                         |
//+------------------------------------------------------------------+
input string          InpSymbol       = "EURUSD";
input ENUM_TIMEFRAMES InpTF           = PERIOD_M5;
input double          InpBaseLot      = 0.01;
input double          InpMaxLotMult   = 2.0;
input int             InpCE_ATR       = 22;
input double          InpCE_Mult      = 3.0;
input int             InpSR_Lookback  = 20;
input double          InpSR_VolThresh = 2.5;
input int             InpRSI_Period   = 8;
input double          InpRSI_OS       = 35.0;
input double          InpRSI_OB       = 65.0;
input int             InpEMA_Fast     = 8;
input int             InpEMA_Slow     = 21;
input double          InpSL_ATR       = 1.5;
input double          InpTP_ATR       = 2.5;
input int             InpMaxLoss      = 3;
input int             InpPauseMins    = 45;
input double          InpMinConf      = 70.0;
input bool            InpDemoMode     = true;
input bool            InpShowPanel    = true;

//+------------------------------------------------------------------+
//| التعدادات                                                        |
//+------------------------------------------------------------------+
enum MarketRegime { REGIME_TREND, REGIME_RANGE, REGIME_NEUTRAL, REGIME_VOLATILE };
enum ZoneType     { ZONE_SUPPORT, ZONE_RESISTANCE };

//+------------------------------------------------------------------+
//| البنيات                                                          |
//+------------------------------------------------------------------+
struct TickData {
    double   price;
    datetime time_ms;
};

struct SRZone {
    double   price_top;
    double   price_bottom;
    double   delta_vol;
    ZoneType zone_type;
    bool     is_flipped;
    datetime created_bar;
    int      touch_count;
    bool     active;
    string   obj_box_name;
    string   obj_label_name;
};

struct KalmanState {
    double estimate;
    double error_cov;
    double process_noise;
    double meas_noise;
    double stddev;
};

struct ChandelierState {
    double long_stop;
    double short_stop;
    int    direction;
};

struct BBResult {
    double upper;
    double middle;
    double lower;
    double bandwidth;
    bool   squeeze;
};

struct FibLevels {
    double swing_high;
    double swing_low;
    double f236, f382, f500, f618, f786;
};

//+------------------------------------------------------------------+
//| المتغيرات العامة                                                 |
//+------------------------------------------------------------------+
CTrade trade;

// مقابض المؤشرات
int g_rsi_h    = INVALID_HANDLE;
int g_atr_h    = INVALID_HANDLE;
int g_maFast_h = INVALID_HANDLE;
int g_maSlow_h = INVALID_HANDLE;
int g_macd_h   = INVALID_HANDLE;
int g_bb_h     = INVALID_HANDLE;
int g_atrCE_h  = INVALID_HANDLE;
int g_e5m1_h   = INVALID_HANDLE;
int g_e21m1_h  = INVALID_HANDLE;

// TVE
TickData g_tve_buf[TVE_BUF_SIZE];
int      g_tve_idx     = 0;
int      g_tve_count   = 0;
double   g_tve_sigma   = 3.0;
datetime g_tve_last_ms = 0;

// A2 — streak تتبع الاتجاه المتتالي
double   g_prev_bid   = 0.0;
int      g_streak_cnt = 0;
int      g_streak_dir = 0;

// A3 — كثافة التيكات
int      g_tps_cnt     = 0;
datetime g_tps_start   = 0;
double   g_tps_baseline= 2.0;
double   g_cur_tps     = 0.0;

// Kalman
KalmanState g_kalman;

// Hurst / Regime
MarketRegime g_regime       = REGIME_NEUTRAL;
double       g_hurst        = 0.5;
int          g_hurst_bar_cnt= 0;
double       g_atr_val      = 0.0;
double       g_atr_sma50    = 0.0;
double       g_atr_hist[50];
int          g_atr_hist_i   = 0;
int          g_atr_hist_cnt = 0;

// Chandelier Exit
ChandelierState g_ce;
int             g_ce_prev_dir = 0;

// SR Zones
SRZone   g_zones[MAX_ZONES];
int      g_zone_cnt     = 0;
datetime g_sr_last_bar  = 0;
string   g_last_brk_txt = "---";
double   g_last_brk_px  = 0.0;

// Adaptive weights
double g_w[TOTAL_ALGOS];
bool   g_algo_fired[TOTAL_ALGOS];

// Pattern tracker (D1-D15)
int    g_pt_trades[15];
int    g_pt_wins[15];
int    g_last_pat_idx = -1;

// Regime stats
int    g_regime_trades[4];
int    g_regime_wins[4];
bool   g_regime_blocked[4];

// Kelly / Trade stats
int      g_total_trades  = 0;
int      g_total_wins    = 0;
double   g_total_pnl     = 0.0;
double   g_kelly_lot     = 0.01;
int      g_loss_streak   = 0;
datetime g_pause_until   = 0;

// Trade state
datetime g_last_candle    = 0;
datetime g_cooldown_until = 0;
ulong    g_cur_ticket     = 0;
double   g_entry_px       = 0.0;
double   g_sl_px          = 0.0;
double   g_tp_px          = 0.0;
int      g_cur_dir        = 0;
bool     g_in_trade       = false;
datetime g_trade_open_t   = 0;

// SEE — Smart Early Entry
datetime g_see_fire_t  = 0;
int      g_see_dir     = 0;
bool     g_see_pending = false;
double   g_see_conf    = 0.0;

// Spread tracking
double g_spread_hist[20];
int    g_spread_i   = 0;
double g_avg_spread = 0.0003;

// قيم سابقة للمؤشرات
double g_prev_macd_main = 0.0;
double g_prev_macd_sig  = 0.0;
bool   g_macd_inited    = false;
bool   g_prev_fast_abv  = false;
bool   g_ema_inited     = false;
double g_prev_stoch_k   = 50.0;

// إحصائيات اليوم
int      g_td_trades = 0;
int      g_td_wins   = 0;
double   g_td_pnl    = 0.0;
datetime g_td_date   = 0;

// ذاكرة التحليل الأخير
double g_last_score   = 0.0;
double g_last_conf    = 0.0;
int    g_last_dir     = 0;
string g_last_pattern = "لا نمط";
string g_ce_txt       = "---";
bool   g_in_sr        = false;
double g_last_rsi_v   = 50.0;
bool   g_macd_cross   = false;
double g_last_atr_v   = 0.0;
double g_kalman_delta = 0.0;

// لوحة التحكم
datetime g_dash_last_ms = 0;

// ذاكرة درجة TVE لـ السجل (تُحدَّث داخل RunAnalysis)
double g_sA1_last = 0.0;

//+------------------------------------------------------------------+
//| § 1 — دوال مساعدة للشموع                                        |
//+------------------------------------------------------------------+

// حساب جسم الشمعة
double CBody(int i)  { return MathAbs(iClose(_Symbol,PERIOD_M5,i) - iOpen(_Symbol,PERIOD_M5,i)); }
// حساب نطاق الشمعة الكامل
double CRange(int i) { return iHigh(_Symbol,PERIOD_M5,i) - iLow(_Symbol,PERIOD_M5,i); }
// الظل العلوي
double CUWick(int i) { return iHigh(_Symbol,PERIOD_M5,i)  - MathMax(iOpen(_Symbol,PERIOD_M5,i), iClose(_Symbol,PERIOD_M5,i)); }
// الظل السفلي
double CLWick(int i) { return MathMin(iOpen(_Symbol,PERIOD_M5,i), iClose(_Symbol,PERIOD_M5,i)) - iLow(_Symbol,PERIOD_M5,i); }
// هل الشمعة صاعدة؟
bool   CIsBull(int i){ return iClose(_Symbol,PERIOD_M5,i) > iOpen(_Symbol,PERIOD_M5,i); }
// هل الشمعة هابطة؟
bool   CIsBear(int i){ return iClose(_Symbol,PERIOD_M5,i) < iOpen(_Symbol,PERIOD_M5,i); }

//+------------------------------------------------------------------+
//| § 2 — محرك سرعة التيك (TVE — Engine 1)                          |
//+------------------------------------------------------------------+

// تحديث مخزن التيكات — يُستدعى في كل تيك
void TVE_Update() {
    double   bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
    datetime now = (datetime)(GetMicrosecondCount() / 1000);

    g_tve_buf[g_tve_idx].price   = bid;
    g_tve_buf[g_tve_idx].time_ms = now;
    g_tve_idx   = (g_tve_idx + 1) % TVE_BUF_SIZE;
    g_tve_count = (int)MathMin(g_tve_count + 1, TVE_BUF_SIZE);

    // Adaptive sigma decay: 3.0 → 1.8 بعد 5 دقائق خمول
    if(now - g_tve_last_ms > 300000)
        g_tve_sigma = MathMax(1.8, g_tve_sigma - 0.1);

    // A2 — streak الاتجاه المتتالي
    if(g_prev_bid > 0) {
        int dir = (bid > g_prev_bid) ? 1 : (bid < g_prev_bid) ? -1 : 0;
        if(dir != 0) {
            if(dir == g_streak_dir) g_streak_cnt++;
            else { g_streak_dir = dir; g_streak_cnt = 1; }
        }
    }
    g_prev_bid = bid;

    // A3 — حساب التيكات في الثانية
    datetime window_ms = 1000;
    g_tps_cnt++;
    if(now - g_tps_start >= window_ms) {
        g_cur_tps    = (double)g_tps_cnt / ((double)(now - g_tps_start) / 1000.0);
        g_tps_cnt    = 0;
        g_tps_start  = now;
        // تحديث الـ baseline تدريجياً
        g_tps_baseline = g_tps_baseline * 0.95 + g_cur_tps * 0.05;
        if(g_tps_baseline < 0.5) g_tps_baseline = 0.5;
    }
}

// احسب درجة TVE — يُعيد +2.5 صاعد / -2.5 هابط / 0
double TVE_GetScore() {
    if(g_tve_count < 10) return 0;

    double velocities[15];
    int    v_count = 0;

    for(int i = 1; i < (int)MathMin(15, g_tve_count); i++) {
        int curr = (g_tve_idx - i     + TVE_BUF_SIZE) % TVE_BUF_SIZE;
        int prev = (g_tve_idx - i - 1 + TVE_BUF_SIZE) % TVE_BUF_SIZE;
        double dt = (double)(g_tve_buf[curr].time_ms - g_tve_buf[prev].time_ms);
        if(dt <= 0) continue;
        velocities[v_count++] = MathAbs(g_tve_buf[curr].price - g_tve_buf[prev].price) / dt;
    }
    if(v_count < 5) return 0;

    double mean = 0;
    for(int i = 0; i < v_count; i++) mean += velocities[i];
    mean /= v_count;

    double variance = 0;
    for(int i = 0; i < v_count; i++)
        variance += MathPow(velocities[i] - mean, 2);
    double stddev = MathSqrt(variance / v_count);
    if(stddev == 0) return 0;

    int    curr0   = (g_tve_idx - 1 + TVE_BUF_SIZE) % TVE_BUF_SIZE;
    int    prev0   = (g_tve_idx - 2 + TVE_BUF_SIZE) % TVE_BUF_SIZE;
    double dt0     = (double)(g_tve_buf[curr0].time_ms - g_tve_buf[prev0].time_ms);
    if(dt0 <= 0) return 0;

    double last_vel = MathAbs(g_tve_buf[curr0].price - g_tve_buf[prev0].price) / dt0;
    double z_score  = (last_vel - mean) / stddev;
    if(z_score < g_tve_sigma) return 0;

    bool price_up      = (g_tve_buf[curr0].price > g_tve_buf[prev0].price);
    g_tve_last_ms      = (datetime)(GetMicrosecondCount() / 1000);
    g_tve_sigma        = 3.0;
    return price_up ? 2.5 : -2.5;
}

// A2 — درجة الاتجاه المتتالي
double A2_TickStreak() {
    if(g_streak_cnt < 3) return 0;
    return (g_streak_dir > 0) ? 1.5 : -1.5;
}

// A3 — درجة كثافة التيكات
double A3_TickDensity() {
    if(g_tps_baseline <= 0) return 0;
    if(g_cur_tps < 1.5 * g_tps_baseline) return 0;
    double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
    int    curr = (g_tve_idx - 1 + TVE_BUF_SIZE) % TVE_BUF_SIZE;
    int    prev = (g_tve_idx - 3 + TVE_BUF_SIZE) % TVE_BUF_SIZE;
    if(g_tve_count < 3) return 0;
    bool rising = (g_tve_buf[curr].price > g_tve_buf[prev].price);
    return rising ? 1.0 : -1.0;
}

//+------------------------------------------------------------------+
//| § 3 — فلتر كالمان (Engine 2)                                     |
//+------------------------------------------------------------------+

// تهيئة فلتر كالمان
void KalmanInit() {
    g_kalman.estimate      = iClose(_Symbol, PERIOD_M5, 0);
    g_kalman.error_cov     = 1.0;
    g_kalman.process_noise = 1e-5;
    g_kalman.meas_noise    = 0.01;
    g_kalman.stddev        = 0.0001;
}

// تحديث فلتر كالمان بسعر جديد
void KalmanUpdate(double price) {
    double pred_cov    = g_kalman.error_cov + g_kalman.process_noise;
    double gain        = pred_cov / (pred_cov + g_kalman.meas_noise);
    double innovation  = price - g_kalman.estimate;

    g_kalman.estimate  = g_kalman.estimate + gain * innovation;
    g_kalman.error_cov = (1.0 - gain) * pred_cov;

    double alpha       = 0.1;
    g_kalman.stddev    = MathSqrt((1.0 - alpha) * g_kalman.stddev * g_kalman.stddev
                                  + alpha * innovation * innovation);
    g_kalman_delta     = innovation;
}

// B1 — درجة انحراف كالمان
double KalmanScore(double price) {
    double sigma = g_kalman.stddev;
    if(sigma == 0) return 0;
    double z = (price - g_kalman.estimate) / sigma;
    if(z >  2.0) return -1.5;
    if(z < -2.0) return  1.5;
    return 0;
}

//+------------------------------------------------------------------+
//| § 4 — مؤشر هيرست + تصنيف النظام (Engine 3)                      |
//+------------------------------------------------------------------+

// حساب مؤشر هيرست بطريقة R/S
double CalcHurst(int n = 50) {
    double closes[];
    ArraySetAsSeries(closes, true);
    if(CopyClose(_Symbol, PERIOD_M5, 0, n, closes) < n) return 0.5;

    double returns[];
    ArrayResize(returns, n - 1);
    for(int i = 0; i < n - 1; i++) {
        if(closes[i+1] <= 0) { returns[i] = 0; continue; }
        returns[i] = MathLog(closes[i] / closes[i+1]);
    }

    double mean = 0;
    for(int i = 0; i < n - 1; i++) mean += returns[i];
    mean /= (n - 1);

    double cum_dev[];
    ArrayResize(cum_dev, n - 1);
    double running = 0;
    for(int i = 0; i < n - 1; i++) {
        running    += returns[i] - mean;
        cum_dev[i]  = running;
    }

    double max_d = cum_dev[0], min_d = cum_dev[0], variance = 0;
    for(int i = 0; i < n - 1; i++) {
        max_d    = MathMax(max_d, cum_dev[i]);
        min_d    = MathMin(min_d, cum_dev[i]);
        variance += (returns[i] - mean) * (returns[i] - mean);
    }
    double R  = max_d - min_d;
    double S  = MathSqrt(variance / (n - 1));
    if(S == 0) return 0.5;
    return MathLog(R / S) / MathLog((n - 1) / 2.0);
}

// تحديث ATR والنظام — كل 20 شمعة
void UpdateRegime() {
    // حساب ATR الحالي
    double atr_buf[];
    ArraySetAsSeries(atr_buf, true);
    if(CopyBuffer(g_atr_h, 0, 1, 1, atr_buf) >= 1)
        g_atr_val = atr_buf[0];

    // تحديث مخزن ATR للمتوسط
    g_atr_hist[g_atr_hist_i] = g_atr_val;
    g_atr_hist_i   = (g_atr_hist_i + 1) % 50;
    g_atr_hist_cnt = (int)MathMin(g_atr_hist_cnt + 1, 50);

    if(g_atr_hist_cnt >= 10) {
        double sum = 0;
        for(int i = 0; i < g_atr_hist_cnt; i++) sum += g_atr_hist[i];
        g_atr_sma50 = sum / g_atr_hist_cnt;
    }

    g_hurst_bar_cnt++;
    if(g_hurst_bar_cnt < 20) return;
    g_hurst_bar_cnt = 0;

    g_hurst  = CalcHurst(50);

    // تصنيف النظام
    if(g_atr_sma50 > 0 && g_atr_val > 1.8 * g_atr_sma50)
        g_regime = REGIME_VOLATILE;
    else if(g_hurst > 0.60)
        g_regime = REGIME_TREND;
    else if(g_hurst < 0.40)
        g_regime = REGIME_RANGE;
    else
        g_regime = REGIME_NEUTRAL;
}

// B2 — درجة تحيز النظام
double B2_HurstBias() {
    double ema_buf[];
    ArraySetAsSeries(ema_buf, true);
    if(CopyBuffer(g_maSlow_h, 0, 1, 1, ema_buf) < 1) return 0;
    double ema21 = ema_buf[0];
    double price = iClose(_Symbol, PERIOD_M5, 1);
    double mult  = (g_regime == REGIME_VOLATILE) ? 0.3 : 1.0;

    switch(g_regime) {
        case REGIME_TREND:
            return (price > ema21) ? 1.0 * mult : -1.0 * mult;
        case REGIME_RANGE:
            return (price > ema21) ? -0.5 * mult : 0.5 * mult;
        default:
            return (price > ema21) ? 0.5 * mult : -0.5 * mult;
    }
}

//+------------------------------------------------------------------+
//| § 5 — Chandelier Exit                                            |
//+------------------------------------------------------------------+

// تهيئة Chandelier Exit
void ChandelierInit() {
    g_ce.long_stop  = 0;
    g_ce.short_stop = DBL_MAX;
    g_ce.direction  = 0;
    g_ce_prev_dir   = 0;
}

// تحديث Chandelier Exit
void ChandelierUpdate() {
    double atr_buf[];
    ArraySetAsSeries(atr_buf, true);
    if(CopyBuffer(g_atrCE_h, 0, 1, 1, atr_buf) < 1) return;
    double atr_val = atr_buf[0];

    int hi_idx = iHighest(_Symbol, PERIOD_M5, MODE_HIGH, InpCE_ATR, 1);
    int lo_idx = iLowest (_Symbol, PERIOD_M5, MODE_LOW,  InpCE_ATR, 1);
    double highest = iHigh(_Symbol, PERIOD_M5, hi_idx);
    double lowest  = iLow (_Symbol, PERIOD_M5, lo_idx);

    double new_long  = highest - InpCE_Mult * atr_val;
    double new_short = lowest  + InpCE_Mult * atr_val;

    double prev_close = iClose(_Symbol, PERIOD_M5, 2);
    if(g_ce.long_stop == 0) {
        g_ce.long_stop  = new_long;
        g_ce.short_stop = new_short;
    } else {
        g_ce.long_stop  = (prev_close > g_ce.long_stop)
                          ? MathMax(new_long,  g_ce.long_stop)
                          : new_long;
        g_ce.short_stop = (prev_close < g_ce.short_stop)
                          ? MathMin(new_short, g_ce.short_stop)
                          : new_short;
    }

    double close = iClose(_Symbol, PERIOD_M5, 1);
    g_ce_prev_dir = g_ce.direction;
    if(close > g_ce.short_stop) g_ce.direction =  1;
    if(close < g_ce.long_stop)  g_ce.direction = -1;
}

// C1 — درجة Chandelier Exit
double C1_ChandelierScore() {
    bool changed = (g_ce.direction != g_ce_prev_dir && g_ce_prev_dir != 0);
    if(changed)
        g_ce_txt = (g_ce.direction > 0) ? "كسر صاعد ✅" : "كسر هابط 🔴";
    else
        g_ce_txt = (g_ce.direction > 0) ? "صاعد ✅" : "هابط 🔴";

    if(changed) return g_ce.direction * 2.0;
    return       g_ce.direction * 1.0;
}

//+------------------------------------------------------------------+
//| § 6 — مناطق الدعم والمقاومة (SR Volume Zones)                   |
//+------------------------------------------------------------------+

// إضافة منطقة جديدة إن لم تكن موجودة
void AddZone(double bottom, double top, double delta, ZoneType type, datetime bar_time) {
    for(int i = 0; i < g_zone_cnt; i++) {
        if(MathAbs(g_zones[i].price_top - top) < 5 * _Point) return;
    }
    int idx = g_zone_cnt % MAX_ZONES;
    g_zones[idx].price_top      = top;
    g_zones[idx].price_bottom   = bottom;
    g_zones[idx].delta_vol      = delta;
    g_zones[idx].zone_type      = type;
    g_zones[idx].is_flipped     = false;
    g_zones[idx].created_bar    = bar_time;
    g_zones[idx].touch_count    = 0;
    g_zones[idx].active         = true;
    g_zones[idx].obj_box_name   = "SR_BOX_" + IntegerToString(idx);
    g_zones[idx].obj_label_name = "SR_LBL_" + IntegerToString(idx);
    g_zone_cnt++;
}

// رسم تسمية الكسر على الشارت
void DrawBreakoutLabel(int idx, string txt, color col) {
    string name = "SR_BRK_" + IntegerToString((int)TimeCurrent()) + "_" + IntegerToString(idx);
    double px   = g_zones[idx].is_flipped ? g_zones[idx].price_bottom : g_zones[idx].price_top;
    ObjectCreate(0, name, OBJ_TEXT, 0, TimeCurrent(), px);
    ObjectSetString (0, name, OBJPROP_TEXT,  txt);
    ObjectSetInteger(0, name, OBJPROP_COLOR, col);
    ObjectSetInteger(0, name, OBJPROP_FONTSIZE, 9);
    g_last_brk_txt = txt;
    g_last_brk_px  = px;
}

// فحص كسر المناطق
void CheckBreakouts() {
    double price = iClose(_Symbol, PERIOD_M5, 1);
    for(int i = 0; i < (int)MathMin(g_zone_cnt, MAX_ZONES); i++) {
        if(!g_zones[i].active) continue;

        int bars_ago = iBarShift(_Symbol, PERIOD_M5, g_zones[i].created_bar);
        if(bars_ago > 50) { g_zones[i].active = false; continue; }

        bool acting_as_support =
            (g_zones[i].zone_type == ZONE_SUPPORT    && !g_zones[i].is_flipped) ||
            (g_zones[i].zone_type == ZONE_RESISTANCE &&  g_zones[i].is_flipped);

        if(acting_as_support && price < g_zones[i].price_bottom) {
            g_zones[i].is_flipped = true;
            g_zones[i].zone_type  = ZONE_RESISTANCE;
            Print("⚠️ كسر دعم عند: ", DoubleToString(g_zones[i].price_bottom, _Digits));
            DrawBreakoutLabel(i, "كسر دعم 🔴", clrRed);
        } else if(!acting_as_support && price > g_zones[i].price_top) {
            g_zones[i].is_flipped = true;
            g_zones[i].zone_type  = ZONE_SUPPORT;
            Print("✅ كسر مقاومة عند: ", DoubleToString(g_zones[i].price_top, _Digits));
            DrawBreakoutLabel(i, "كسر مقاومة 🟢", clrLime);
        }
    }
}

// رسم جميع المناطق على الشارت
void DrawAllZones() {
    bool is_testing = (bool)MQLInfoInteger(MQL_TESTER);
    bool is_visual  = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
    if(is_testing && !is_visual) return;

    for(int i = 0; i < (int)MathMin(g_zone_cnt, MAX_ZONES); i++) {
        if(!g_zones[i].active) continue;

        bool  is_support   = (g_zones[i].zone_type == ZONE_SUPPORT);
        color zone_color   = is_support ? clrGreen : clrRed;
        ENUM_LINE_STYLE st = g_zones[i].is_flipped ? STYLE_DASH : STYLE_SOLID;

        datetime t1 = g_zones[i].created_bar;
        datetime t2 = iTime(_Symbol, PERIOD_M5, 0) + PeriodSeconds(PERIOD_M5) * 10;

        if(ObjectFind(0, g_zones[i].obj_box_name) < 0)
            ObjectCreate(0, g_zones[i].obj_box_name, OBJ_RECTANGLE, 0,
                         t1, g_zones[i].price_top, t2, g_zones[i].price_bottom);

        ObjectSetInteger(0, g_zones[i].obj_box_name, OBJPROP_COLOR,
                         ColorToARGB(zone_color, 50));
        ObjectSetInteger(0, g_zones[i].obj_box_name, OBJPROP_STYLE,  st);
        ObjectSetInteger(0, g_zones[i].obj_box_name, OBJPROP_FILL,   true);
        ObjectSetInteger(0, g_zones[i].obj_box_name, OBJPROP_BACK,   true);

        string vol_txt = "Vol: " + DoubleToString(MathAbs(g_zones[i].delta_vol), 0);
        if(ObjectFind(0, g_zones[i].obj_label_name) < 0)
            ObjectCreate(0, g_zones[i].obj_label_name, OBJ_TEXT, 0,
                         t1, (g_zones[i].price_top + g_zones[i].price_bottom) / 2.0);
        ObjectSetString (0, g_zones[i].obj_label_name, OBJPROP_TEXT,     vol_txt);
        ObjectSetInteger(0, g_zones[i].obj_label_name, OBJPROP_COLOR,    clrWhite);
        ObjectSetInteger(0, g_zones[i].obj_label_name, OBJPROP_FONTSIZE, 8);
    }
}

// تحديث مناطق SR على شمعة جديدة
void SRZones_Update() {
    double avg_delta = 0;
    for(int i = 1; i <= InpSR_Lookback; i++) {
        double vol       = (double)iVolume(_Symbol, PERIOD_M5, i);
        bool   bull_can  = iClose(_Symbol, PERIOD_M5, i) > iOpen(_Symbol, PERIOD_M5, i);
        avg_delta += bull_can ? vol : -vol;
    }
    avg_delta = MathAbs(avg_delta / InpSR_Lookback);
    if(avg_delta == 0) return;

    for(int i = 2; i < InpSR_Lookback - 2; i++) {
        double vol      = (double)iVolume(_Symbol, PERIOD_M5, i);
        bool   bull_can = iClose(_Symbol, PERIOD_M5, i) > iOpen(_Symbol, PERIOD_M5, i);
        double delta    = bull_can ? vol : -vol;

        bool is_ph = iHigh(_Symbol,PERIOD_M5,i) >= iHigh(_Symbol,PERIOD_M5,i-1) &&
                     iHigh(_Symbol,PERIOD_M5,i) >= iHigh(_Symbol,PERIOD_M5,i+1);
        bool is_pl = iLow (_Symbol,PERIOD_M5,i) <= iLow (_Symbol,PERIOD_M5,i-1) &&
                     iLow (_Symbol,PERIOD_M5,i) <= iLow (_Symbol,PERIOD_M5,i+1);

        if(MathAbs(delta) < InpSR_VolThresh * avg_delta) continue;

        if(is_pl && delta > 0)
            AddZone(iLow(_Symbol,PERIOD_M5,i),   iClose(_Symbol,PERIOD_M5,i),
                    delta, ZONE_SUPPORT,    iTime(_Symbol,PERIOD_M5,i));
        if(is_ph && delta < 0)
            AddZone(iOpen(_Symbol,PERIOD_M5,i),  iHigh(_Symbol,PERIOD_M5,i),
                    delta, ZONE_RESISTANCE, iTime(_Symbol,PERIOD_M5,i));
    }
    CheckBreakouts();
    DrawAllZones();
}

// C2 — درجة منطقة SR
double C2_SRZoneScore() {
    double price = SymbolInfoDouble(_Symbol, SYMBOL_BID);
    g_in_sr      = false;
    for(int i = 0; i < (int)MathMin(g_zone_cnt, MAX_ZONES); i++) {
        if(!g_zones[i].active) continue;
        if(price >= g_zones[i].price_bottom && price <= g_zones[i].price_top) {
            g_in_sr = true;
            return (g_zones[i].zone_type == ZONE_SUPPORT) ? 2.5 : -2.5;
        }
    }
    return 0;
}

// حذف كل مناطق SR
void SRZones_Cleanup() {
    for(int i = 0; i < MAX_ZONES; i++) {
        ObjectDelete(0, "SR_BOX_" + IntegerToString(i));
        ObjectDelete(0, "SR_LBL_" + IntegerToString(i));
    }
    ObjectsDeleteAll(0, "SR_BRK_");
}

//+------------------------------------------------------------------+
//| § 7 — أنماط الشموع (15 نمط كامل)                               |
//+------------------------------------------------------------------+

bool IsHammer(int i=1) {
    if(CBody(i)==0) return false;
    return CLWick(i) >= 2.0*CBody(i) && CUWick(i) <= 0.3*CBody(i) && CBody(i)>0;
}
bool IsInvHammer(int i=1) {
    if(CBody(i)==0) return false;
    return CUWick(i) >= 2.0*CBody(i) && CLWick(i) <= 0.3*CBody(i) && CBody(i)>0;
}
bool IsBullEngulf(int i=1) {
    return CIsBear(i+1) && CIsBull(i) &&
           iOpen(_Symbol,PERIOD_M5,i)  <= iClose(_Symbol,PERIOD_M5,i+1) &&
           iClose(_Symbol,PERIOD_M5,i) >= iOpen (_Symbol,PERIOD_M5,i+1);
}
bool IsBearEngulf(int i=1) {
    return CIsBull(i+1) && CIsBear(i) &&
           iOpen(_Symbol,PERIOD_M5,i)  >= iClose(_Symbol,PERIOD_M5,i+1) &&
           iClose(_Symbol,PERIOD_M5,i) <= iOpen (_Symbol,PERIOD_M5,i+1);
}
bool IsMorningStar(int i=1) {
    return CIsBear(i+2) && CBody(i+1) < 0.3*CBody(i+2) && CIsBull(i) &&
           iClose(_Symbol,PERIOD_M5,i) > (iOpen(_Symbol,PERIOD_M5,i+2)+iClose(_Symbol,PERIOD_M5,i+2))/2.0;
}
bool IsEveningStar(int i=1) {
    return CIsBull(i+2) && CBody(i+1) < 0.3*CBody(i+2) && CIsBear(i) &&
           iClose(_Symbol,PERIOD_M5,i) < (iOpen(_Symbol,PERIOD_M5,i+2)+iClose(_Symbol,PERIOD_M5,i+2))/2.0;
}
bool IsDoji(int i=1) {
    if(CRange(i)==0) return false;
    return CBody(i)/CRange(i) < 0.08;
}
bool IsMarubozuBull(int i=1) {
    if(CRange(i)==0) return false;
    return CIsBull(i) && CBody(i)/CRange(i) > 0.96;
}
bool IsMarubozuBear(int i=1) {
    if(CRange(i)==0) return false;
    return CIsBear(i) && CBody(i)/CRange(i) > 0.96;
}
bool IsPiercingLine(int i=1) {
    double mid = (iOpen(_Symbol,PERIOD_M5,i+1)+iClose(_Symbol,PERIOD_M5,i+1))/2.0;
    return CIsBear(i+1) && CIsBull(i) &&
           iOpen (_Symbol,PERIOD_M5,i) < iClose(_Symbol,PERIOD_M5,i+1) &&
           iClose(_Symbol,PERIOD_M5,i) > mid &&
           iClose(_Symbol,PERIOD_M5,i) < iOpen(_Symbol,PERIOD_M5,i+1);
}
bool IsDarkCloud(int i=1) {
    double mid = (iOpen(_Symbol,PERIOD_M5,i+1)+iClose(_Symbol,PERIOD_M5,i+1))/2.0;
    return CIsBull(i+1) && CIsBear(i) &&
           iOpen (_Symbol,PERIOD_M5,i) > iClose(_Symbol,PERIOD_M5,i+1) &&
           iClose(_Symbol,PERIOD_M5,i) < mid &&
           iClose(_Symbol,PERIOD_M5,i) > iOpen(_Symbol,PERIOD_M5,i+1);
}
bool IsTweezerBot(int i=1) {
    return MathAbs(iLow(_Symbol,PERIOD_M5,i)-iLow(_Symbol,PERIOD_M5,i+1)) < 0.0001 &&
           CIsBear(i+1) && CIsBull(i);
}
bool IsTweezerTop(int i=1) {
    return MathAbs(iHigh(_Symbol,PERIOD_M5,i)-iHigh(_Symbol,PERIOD_M5,i+1)) < 0.0001 &&
           CIsBull(i+1) && CIsBear(i);
}
bool IsHaramiBull(int i=1) {
    return CIsBear(i+1) && CIsBull(i) &&
           iOpen (_Symbol,PERIOD_M5,i) > iClose(_Symbol,PERIOD_M5,i+1) &&
           iClose(_Symbol,PERIOD_M5,i) < iOpen (_Symbol,PERIOD_M5,i+1) &&
           CBody(i) < 0.55*CBody(i+1);
}
bool IsHaramiBear(int i=1) {
    return CIsBull(i+1) && CIsBear(i) &&
           iOpen (_Symbol,PERIOD_M5,i) < iClose(_Symbol,PERIOD_M5,i+1) &&
           iClose(_Symbol,PERIOD_M5,i) > iOpen (_Symbol,PERIOD_M5,i+1) &&
           CBody(i) < 0.55*CBody(i+1);
}

// أسماء الأنماط
string PAT_NAMES[15] = {
    "نجمة الصباح","نجمة المساء","مارو صاعد","مارو هابط",
    "ابتلاع صاعد","ابتلاع هابط","مطرقة","خط الاختراق",
    "غيوم داكنة","مطرقة مقلوبة","قاع ملقط","قمة ملقط",
    "حرامي صاعد","حرامي هابط","دوجي"
};
double PAT_SCORES[15] = { 2.0,-2.0,1.5,-1.5,1.5,-1.5,1.5,1.0,-1.0,1.0,1.0,-1.0,0.8,-0.8,-0.5 };
// ترتيب المؤشر في مصفوفة g_pt_trades
int    PAT_IDX[15]    = { 4,5,7,8,2,3,0,9,10,1,11,12,13,14,6 };

// مسح الأنماط — يُعيد النقاط + اسم النمط + المؤشر (0-14)
double ScanPatterns(string &out_name, int &out_idx) {
    out_name = "لا نمط"; out_idx = -1;

    #define RET_PAT(n)  { out_name=PAT_NAMES[n]; out_idx=PAT_IDX[n]; return PAT_SCORES[n]; }

    if(IsMorningStar())  RET_PAT(0)
    if(IsEveningStar())  RET_PAT(1)
    if(IsMarubozuBull()) RET_PAT(2)
    if(IsMarubozuBear()) RET_PAT(3)
    if(IsBullEngulf())   RET_PAT(4)
    if(IsBearEngulf())   RET_PAT(5)
    if(IsHammer())       RET_PAT(6)
    if(IsPiercingLine()) RET_PAT(7)
    if(IsDarkCloud())    RET_PAT(8)
    if(IsInvHammer())    RET_PAT(9)
    if(IsTweezerBot())   RET_PAT(10)
    if(IsTweezerTop())   RET_PAT(11)
    if(IsHaramiBull())   RET_PAT(12)
    if(IsHaramiBear())   RET_PAT(13)
    if(IsDoji())         RET_PAT(14)

    #undef RET_PAT
    return 0;
}

//+------------------------------------------------------------------+
//| § 8 — المؤشرات التقنية (B3-B8, C3-C6)                          |
//+------------------------------------------------------------------+

// B3 — درجة RSI
double B3_RSIScore() {
    double buf[];
    ArraySetAsSeries(buf, true);
    if(CopyBuffer(g_rsi_h, 0, 0, 3, buf) < 3) return 0;
    if(buf[0] == EMPTY_VALUE) return 0;
    g_last_rsi_v = buf[0];
    if(buf[0] < InpRSI_OS)          return  1.0;
    if(buf[0] > InpRSI_OB)          return -1.0;
    if(buf[0] < InpRSI_OS + 10.0)   return  0.5;
    if(buf[0] > InpRSI_OB - 10.0)   return -0.5;
    return 0;
}

// B4 — StochRSI مع كشف التقاطع
double B4_StochRSIScore() {
    int period = 14, k_period = 3;
    double rsi_arr[];
    ArraySetAsSeries(rsi_arr, true);
    int rsi_tmp = iRSI(_Symbol, PERIOD_M5, period, PRICE_CLOSE);
    if(rsi_tmp == INVALID_HANDLE) return 0;
    int copied = CopyBuffer(rsi_tmp, 0, 0, period + k_period + 3, rsi_arr);
    IndicatorRelease(rsi_tmp);
    if(copied < period + 2) return 0;

    double min_r = rsi_arr[0], max_r = rsi_arr[0];
    for(int i = 0; i < period; i++) {
        min_r = MathMin(min_r, rsi_arr[i]);
        max_r = MathMax(max_r, rsi_arr[i]);
    }
    double k = (max_r == min_r) ? 50.0 : 100.0 * (rsi_arr[0] - min_r) / (max_r - min_r);

    // حساب %D (SMA3 of K)
    double min_p = rsi_arr[1], max_p = rsi_arr[1];
    for(int i = 1; i <= period; i++) {
        min_p = MathMin(min_p, rsi_arr[i]);
        max_p = MathMax(max_p, rsi_arr[i]);
    }
    double k_prev = (max_p == min_p) ? 50.0 : 100.0 * (rsi_arr[1] - min_p) / (max_p - min_p);

    double score = 0;
    if(k < 20 && k > g_prev_stoch_k)  score =  1.0; // تقاطع صاعد من ذروة البيع
    if(k > 80 && k < g_prev_stoch_k)  score = -1.0; // تقاطع هابط من ذروة الشراء
    g_prev_stoch_k = k;
    return score;
}

// B5 — MACD مع كشف التقاطع
double B5_MACDScore() {
    double main_buf[], sig_buf[];
    ArraySetAsSeries(main_buf, true);
    ArraySetAsSeries(sig_buf,  true);
    if(CopyBuffer(g_macd_h, 0, 0, 3, main_buf) < 3) return 0;
    if(CopyBuffer(g_macd_h, 1, 0, 3, sig_buf)  < 3) return 0;
    if(main_buf[0] == EMPTY_VALUE || sig_buf[0] == EMPTY_VALUE) return 0;

    double hist_now  = main_buf[0] - sig_buf[0];
    double hist_prev = main_buf[1] - sig_buf[1];

    bool cross_up   = (g_macd_inited && g_prev_macd_main <= g_prev_macd_sig && main_buf[0] > sig_buf[0]);
    bool cross_down = (g_macd_inited && g_prev_macd_main >= g_prev_macd_sig && main_buf[0] < sig_buf[0]);

    g_prev_macd_main = main_buf[0];
    g_prev_macd_sig  = sig_buf[0];
    g_macd_inited    = true;
    g_macd_cross     = cross_up;

    if(cross_up   && hist_now > hist_prev) return  1.0;
    if(cross_down && hist_now < hist_prev) return -1.0;
    if(hist_now > 0) return  0.5;
    if(hist_now < 0) return -0.5;
    return 0;
}

// B6 — Bollinger Bands
double B6_BBScore() {
    double upper[], mid[], lower[];
    ArraySetAsSeries(upper, true);
    ArraySetAsSeries(mid,   true);
    ArraySetAsSeries(lower, true);
    if(CopyBuffer(g_bb_h, 1, 0, 3, upper) < 3) return 0;
    if(CopyBuffer(g_bb_h, 0, 0, 3, mid)   < 3) return 0;
    if(CopyBuffer(g_bb_h, 2, 0, 3, lower) < 3) return 0;

    double bw = (mid[0] > 0) ? (upper[0] - lower[0]) / mid[0] : 0;
    double mult = (bw < 0.001) ? 0.5 : 1.0; // BB squeeze

    double price  = iClose(_Symbol, PERIOD_M5, 1);
    double close1 = iOpen (_Symbol, PERIOD_M5, 1);
    if(price <= lower[0] && price > lower[0] - _Point * 10) return  1.0 * mult;
    if(price >= upper[0] && price < upper[0] + _Point * 10) return -1.0 * mult;
    return 0;
}

// B7 — RSI Divergence
double B7_RSIDivergence() {
    int lookback = 10;
    double ph[], pl[], rv[];
    ArraySetAsSeries(ph, true);
    ArraySetAsSeries(pl, true);
    ArraySetAsSeries(rv, true);
    if(CopyHigh(_Symbol, PERIOD_M5, 1, lookback, ph) < lookback) return 0;
    if(CopyLow (_Symbol, PERIOD_M5, 1, lookback, pl) < lookback) return 0;

    int rsi_tmp = iRSI(_Symbol, PERIOD_M5, InpRSI_Period, PRICE_CLOSE);
    if(rsi_tmp == INVALID_HANDLE) return 0;
    int cp = CopyBuffer(rsi_tmp, 0, 1, lookback, rv);
    IndicatorRelease(rsi_tmp);
    if(cp < lookback) return 0;

    // Bearish divergence
    for(int i = 1; i < lookback; i++) {
        if(ph[0] > ph[i] && rv[0] < rv[i]) return -1.5;
    }
    // Bullish divergence
    for(int i = 1; i < lookback; i++) {
        if(pl[0] < pl[i] && rv[0] > rv[i]) return  1.5;
    }
    return 0;
}

// B8 — Linear Regression Slope با R²
double B8_LRSlope() {
    int n = 14;
    double closes[];
    ArraySetAsSeries(closes, true);
    if(CopyClose(_Symbol, PERIOD_M5, 1, n, closes) < n) return 0;

    double sx = 0, sy = 0, sxy = 0, sxx = 0;
    for(int i = 0; i < n; i++) {
        sx  += i;
        sy  += closes[i];
        sxy += i * closes[i];
        sxx += i * i;
    }
    double denom = n * sxx - sx * sx;
    if(denom == 0) return 0;
    double slope     = (n * sxy - sx * sy) / denom;
    double intercept = (sy - slope * sx) / n;

    double mean_y = sy / n, ss_tot = 0, ss_res = 0;
    for(int i = 0; i < n; i++) {
        ss_tot += MathPow(closes[i] - mean_y, 2);
        ss_res += MathPow(closes[i] - (slope * i + intercept), 2);
    }
    double r_sq = (ss_tot > 0) ? 1.0 - ss_res / ss_tot : 0;
    if(r_sq < 0.65) return 0;
    return (slope > 0) ? 0.8 : -0.8;
}

// C3 — EMA Cross
double C3_EMACross() {
    double fast_buf[], slow_buf[];
    ArraySetAsSeries(fast_buf, true);
    ArraySetAsSeries(slow_buf, true);
    if(CopyBuffer(g_maFast_h, 0, 0, 3, fast_buf) < 3) return 0;
    if(CopyBuffer(g_maSlow_h, 0, 0, 3, slow_buf) < 3) return 0;

    bool fast_above = (fast_buf[0] > slow_buf[0]);
    bool cross_up   = (g_ema_inited && !g_prev_fast_abv && fast_above);
    bool cross_down = (g_ema_inited &&  g_prev_fast_abv && !fast_above);
    g_prev_fast_abv = fast_above;
    g_ema_inited    = true;

    if(cross_up)   return  1.0;
    if(cross_down) return -1.0;
    return fast_above ? 0.5 : -0.5;
}

// C4 — Micro Trend على M1
double C4_MicroTrend() {
    double buf[];
    ArraySetAsSeries(buf, true);
    if(CopyBuffer(g_e5m1_h, 0, 0, 3, buf) < 3) return 0;
    return (buf[0] > buf[2]) ? 0.5 : -0.5;
}

// C5 — Fibonacci Retracement
double C5_FibScore() {
    int lookback = 20;
    int hi_idx   = iHighest(_Symbol, PERIOD_M5, MODE_HIGH, lookback, 1);
    int lo_idx   = iLowest (_Symbol, PERIOD_M5, MODE_LOW,  lookback, 1);
    double hi    = iHigh(_Symbol, PERIOD_M5, hi_idx);
    double lo    = iLow (_Symbol, PERIOD_M5, lo_idx);
    double range = hi - lo;
    if(range == 0) return 0;

    FibLevels fib;
    fib.f618 = hi - 0.618 * range;
    fib.f382 = hi - 0.382 * range;
    fib.f500 = hi - 0.500 * range;

    double price = iClose(_Symbol, PERIOD_M5, 1);
    double tol   = 5 * _Point;

    double fast_buf[], slow_buf[];
    ArraySetAsSeries(fast_buf, true);
    ArraySetAsSeries(slow_buf, true);
    if(CopyBuffer(g_maFast_h, 0, 0, 2, fast_buf) < 2) return 0;
    if(CopyBuffer(g_maSlow_h, 0, 0, 2, slow_buf) < 2) return 0;
    int trend = (fast_buf[0] > slow_buf[0]) ? 1 : -1;

    if(trend > 0 && MathAbs(price - fib.f618) < tol) return  1.0;
    if(trend < 0 && MathAbs(price - fib.f382) < tol) return -1.0;
    if(MathAbs(price - fib.f500) < tol) return trend * 0.5;
    return 0;
}

// C6 — Multi-Timeframe Bias
double C6_MTFBias(int signal_dir) {
    if(signal_dir == 0) return 0;
    double buf[];
    ArraySetAsSeries(buf, true);
    if(CopyBuffer(g_e21m1_h, 0, 0, 5, buf) < 5) return 0;
    int m1_dir = (buf[0] > buf[4]) ? 1 : -1;
    return (m1_dir == signal_dir) ? 0.8 : -0.5;
}

//+------------------------------------------------------------------+
//| § 9 — إدارة الـ Spread والأوقات                                  |
//+------------------------------------------------------------------+

// تحديث متوسط الـ Spread
void UpdateSpread() {
    double spread       = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD) * _Point;
    g_spread_hist[g_spread_i] = spread;
    g_spread_i = (g_spread_i + 1) % 20;
    double sum = 0;
    for(int i = 0; i < 20; i++) sum += g_spread_hist[i];
    g_avg_spread = sum / 20.0;
}

// هل الـ Spread مقبول؟ (A4)
bool IsSpreadOK() {
    double spread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD) * _Point;
    return spread <= 3.0 * MathMax(g_avg_spread, 0.0001);
}

// هل وقت التداول مناسب؟
bool IsTradingTime() {
    MqlDateTime dt;
    TimeToStruct(TimeCurrent(), dt);
    if(dt.day_of_week == 5 && dt.hour >= 21) return false;
    if(dt.day_of_week == 6) return false;
    if(dt.day_of_week == 0 && dt.hour < 21)  return false;
    return true;
}

//+------------------------------------------------------------------+
//| § 10 — حارس الاتجاه (Trend Guard)                               |
//+------------------------------------------------------------------+

// يحلل آخر 7 شموع — يُعيد +1 صاعد / -1 هابط / 0 مختلط
int GetTrendGuard() {
    int green = 0, red = 0;
    for(int i = 1; i <= 7; i++) {
        if(CIsBull(i)) green++;
        else if(CIsBear(i)) red++;
    }
    if(green > 0.72 * 7) return  1;  // STRONG_UP — يمنع SELL
    if(red   > 0.72 * 7) return -1;  // STRONG_DOWN — يمنع BUY
    return 0;
}

//+------------------------------------------------------------------+
//| § 11 — محرك SUPREME-PRED v2 (30 خوارزمية)                       |
//+------------------------------------------------------------------+

// تشغيل التحليل الكامل — يُعيد الدرجة الخام
double RunAnalysis(int &out_dir, double &out_conf) {
    // تصفير الأعلام
    for(int i = 0; i < TOTAL_ALGOS; i++) g_algo_fired[i] = false;

    // ─── المجموعة A — ديناميكيات التيك (0.45) ───
    double sA1 = TVE_GetScore();    g_algo_fired[IDX_A1] = (sA1 != 0); g_sA1_last = sA1;
    double sA2 = A2_TickStreak();   g_algo_fired[IDX_A2] = (sA2 != 0);
    double sA3 = A3_TickDensity();  g_algo_fired[IDX_A3] = (sA3 != 0);

    double scoreA = (sA1 * g_w[IDX_A1] + sA2 * g_w[IDX_A2] + sA3 * g_w[IDX_A3]) * 0.45;

    // ─── المجموعة B — إحصائية وكمية (0.30) ───
    double price = SymbolInfoDouble(_Symbol, SYMBOL_BID);
    double sB1 = KalmanScore(price);               g_algo_fired[IDX_B1] = (sB1 != 0);
    double sB2 = B2_HurstBias();                   g_algo_fired[IDX_B2] = (sB2 != 0);
    double sB3 = B3_RSIScore();                    g_algo_fired[IDX_B3] = (sB3 != 0);
    double sB4 = B4_StochRSIScore();               g_algo_fired[IDX_B4] = (sB4 != 0);
    double sB5 = B5_MACDScore();                   g_algo_fired[IDX_B5] = (sB5 != 0);
    double sB6 = B6_BBScore();                     g_algo_fired[IDX_B6] = (sB6 != 0);
    double sB7 = B7_RSIDivergence();               g_algo_fired[IDX_B7] = (sB7 != 0);
    double sB8 = B8_LRSlope();                     g_algo_fired[IDX_B8] = (sB8 != 0);

    double scoreB = (sB1*g_w[IDX_B1] + sB2*g_w[IDX_B2] + sB3*g_w[IDX_B3] +
                     sB4*g_w[IDX_B4] + sB5*g_w[IDX_B5] + sB6*g_w[IDX_B6] +
                     sB7*g_w[IDX_B7] + sB8*g_w[IDX_B8]) * 0.30;

    // ─── المجموعة C — هيكلية (0.15) ───
    double sC1 = C1_ChandelierScore();             g_algo_fired[IDX_C1] = (sC1 != 0);
    double sC2 = C2_SRZoneScore();                 g_algo_fired[IDX_C2] = (sC2 != 0);
    double sC3 = C3_EMACross();                    g_algo_fired[IDX_C3] = (sC3 != 0);
    double sC4 = C4_MicroTrend();                  g_algo_fired[IDX_C4] = (sC4 != 0);
    double sC5 = C5_FibScore();                    g_algo_fired[IDX_C5] = (sC5 != 0);

    // C6 يعتمد على الاتجاه المبدئي
    double prelim = scoreA + scoreB + sC1 + sC2 + sC3 + sC4 + sC5;
    int    prelim_dir = (prelim > 0) ? 1 : (prelim < 0) ? -1 : 0;
    double sC6 = C6_MTFBias(prelim_dir);           g_algo_fired[IDX_C6] = (sC6 != 0);

    double scoreC = (sC1*g_w[IDX_C1] + sC2*g_w[IDX_C2] + sC3*g_w[IDX_C3] +
                     sC4*g_w[IDX_C4] + sC5*g_w[IDX_C5] + sC6*g_w[IDX_C6]) * 0.15;

    // ─── المجموعة D — شموع (0.10) ───
    int    pat_idx  = -1;
    string pat_name = "لا نمط";
    double base_pat = ScanPatterns(pat_name, pat_idx);
    g_last_pattern  = pat_name;
    g_last_pat_idx  = pat_idx;

    double scoreD = 0;
    if(pat_idx >= 0) {
        double pw = g_w[IDX_D1 + pat_idx];
        scoreD    = base_pat * pw * 0.10;
        g_algo_fired[IDX_D1 + pat_idx] = true;
        // تحديث عداد النمط
        g_pt_trades[pat_idx]++;
    }

    // ─── الدرجة الخام ───
    double raw = scoreA + scoreB + scoreC + scoreD;

    // ─── sigmoid confidence 0-100% (map [-8,+8] → [0,100]) ───
    double sig   = 1.0 / (1.0 + MathExp(-raw * 0.5));
    double conf  = sig * 100.0;

    out_dir = (raw > 0) ? 1 : (raw < 0) ? -1 : 0;
    out_conf = conf;

    g_last_score = raw;
    g_last_conf  = conf;
    g_last_dir   = out_dir;
    g_last_atr_v = g_atr_val;

    return raw;
}

//+------------------------------------------------------------------+
//| § 12 — محرك القرار                                              |
//+------------------------------------------------------------------+

// الحد الأدنى من الثقة حسب النظام
double GetMinConf() {
    switch(g_regime) {
        case REGIME_TREND:    return 70.0;
        case REGIME_RANGE:    return 75.0;
        case REGIME_VOLATILE: return 85.0;
        default:              return 80.0;
    }
}
double GetMinScore() {
    switch(g_regime) {
        case REGIME_TREND:    return 3.0;
        case REGIME_RANGE:    return 3.5;
        case REGIME_VOLATILE: return 5.0;
        default:              return 4.0;
    }
}

// هل النظام الحالي محظور؟
bool IsRegimeBlocked() {
    return g_regime_blocked[(int)g_regime];
}

// حساب اللوت بناءً على الثقة
double GetConfLot(double conf) {
    if(conf >= 90.0) return g_kelly_lot * 2.0;
    if(conf >= 80.0) return g_kelly_lot * 1.5;
    return g_kelly_lot;
}

//+------------------------------------------------------------------+
//| § 13 — Kelly Criterion (Engine 5)                                |
//+------------------------------------------------------------------+

// تحديث إحصائيات كيلي بعد إغلاق الصفقة
void UpdateKellyStats(bool is_win, double profit) {
    g_total_trades++;
    g_total_pnl += profit;
    if(is_win) g_total_wins++;

    if(g_total_trades < 10) { g_kelly_lot = InpBaseLot; return; }

    double win_rate = (double)g_total_wins / g_total_trades;
    double avg_rr   = (g_total_trades > 0) ? MathAbs(g_total_pnl / g_total_trades) : 1.67;
    if(avg_rr <= 0) avg_rr = 1.67;

    double kelly = (win_rate - (1.0 - win_rate) / avg_rr) * 0.5;
    kelly = MathMax(0.5, MathMin(2.0, kelly));

    double equity     = AccountInfoDouble(ACCOUNT_EQUITY);
    double risk_lot   = InpBaseLot * kelly;
    double max_risk   = (equity * 0.05) / (150 * _Point * 100000);

    double min_lot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
    double lot_step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
    risk_lot = MathMin(risk_lot, max_risk);
    risk_lot = MathMax(min_lot, MathRound(risk_lot / lot_step) * lot_step);

    g_kelly_lot = NormalizeDouble(risk_lot, 2);
}

// تطبيع اللوت لحدود الوسيط
double NormalizeLot(double lot) {
    double min_lot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
    double max_lot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
    double lot_step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
    lot = MathMax(min_lot, MathMin(max_lot, MathRound(lot / lot_step) * lot_step));
    return NormalizeDouble(lot, 2);
}

//+------------------------------------------------------------------+
//| § 14 — Smart Early Entry — SEE (Engine 6)                        |
//+------------------------------------------------------------------+

// جدولة الدخول المبكر بناءً على الثقة
void SEE_Schedule(double conf, int dir) {
    if(dir == 0) return;
    datetime candle_open  = iTime(_Symbol, InpTF, 0);
    datetime candle_close = candle_open + PeriodSeconds(InpTF);
    datetime now          = TimeCurrent();
    long     remaining_s  = (long)(candle_close - now);
    if(remaining_s <= 0) return;

    double pct = 0;
    if(conf >= 90.0) pct = 0.35;
    else if(conf >= 80.0) pct = 0.20;
    else if(conf >= 70.0) pct = 0.08;
    else return;

    long wait_s = (long)(remaining_s * (1.0 - pct));
    g_see_fire_t  = now + wait_s;
    g_see_dir     = dir;
    g_see_pending = true;
    g_see_conf    = conf;
}

// فحص SEE — يُستدعى في كل تيك/تايمر
bool SEE_ShouldFire() {
    if(!g_see_pending) return false;
    if(TimeCurrent() < g_see_fire_t) return false;
    g_see_pending = false;
    return true;
}

//+------------------------------------------------------------------+
//| § 15 — التعلم التكيفي (Engine 4 + 7)                            |
//+------------------------------------------------------------------+

// تهيئة الأوزان
void InitWeights() {
    for(int i = 0; i < TOTAL_ALGOS; i++) g_w[i] = 1.0;
}

// حفظ الأوزان في GlobalVariables
void SaveWeights() {
    for(int i = 0; i < TOTAL_ALGOS; i++)
        GlobalVariableSet("SUP_W_" + IntegerToString(i), g_w[i]);
    for(int i = 0; i < 15; i++) {
        GlobalVariableSet("SUP_PT_" + IntegerToString(i), g_pt_trades[i]);
        GlobalVariableSet("SUP_PW_" + IntegerToString(i), g_pt_wins[i]);
    }
    GlobalVariableSet("SUP_TOTAL",  g_total_trades);
    GlobalVariableSet("SUP_WINS",   g_total_wins);
    GlobalVariableSet("SUP_PNL",    g_total_pnl);
    GlobalVariableSet("SUP_KELLY",  g_kelly_lot);
    for(int i = 0; i < 4; i++) {
        GlobalVariableSet("SUP_RT_" + IntegerToString(i), g_regime_trades[i]);
        GlobalVariableSet("SUP_RW_" + IntegerToString(i), g_regime_wins[i]);
    }
}

// تحميل الأوزان من GlobalVariables
void LoadWeights() {
    for(int i = 0; i < TOTAL_ALGOS; i++) {
        string key = "SUP_W_" + IntegerToString(i);
        g_w[i] = GlobalVariableCheck(key) ? GlobalVariableGet(key) : 1.0;
        g_w[i] = MathMax(0.30, MathMin(5.0, g_w[i]));
    }
    for(int i = 0; i < 15; i++) {
        string kt = "SUP_PT_" + IntegerToString(i);
        string kw = "SUP_PW_" + IntegerToString(i);
        g_pt_trades[i] = (int)(GlobalVariableCheck(kt) ? GlobalVariableGet(kt) : 0);
        g_pt_wins[i]   = (int)(GlobalVariableCheck(kw) ? GlobalVariableGet(kw) : 0);
    }
    g_total_trades = (int)(GlobalVariableCheck("SUP_TOTAL") ? GlobalVariableGet("SUP_TOTAL") : 0);
    g_total_wins   = (int)(GlobalVariableCheck("SUP_WINS")  ? GlobalVariableGet("SUP_WINS")  : 0);
    g_total_pnl    =       GlobalVariableCheck("SUP_PNL")   ? GlobalVariableGet("SUP_PNL")   : 0.0;
    g_kelly_lot    =       GlobalVariableCheck("SUP_KELLY") ? GlobalVariableGet("SUP_KELLY") : InpBaseLot;
    for(int i = 0; i < 4; i++) {
        g_regime_trades[i] = (int)(GlobalVariableCheck("SUP_RT_"+IntegerToString(i)) ? GlobalVariableGet("SUP_RT_"+IntegerToString(i)) : 0);
        g_regime_wins[i]   = (int)(GlobalVariableCheck("SUP_RW_"+IntegerToString(i)) ? GlobalVariableGet("SUP_RW_"+IntegerToString(i)) : 0);
    }
}

// تحديث الأوزان بعد إغلاق الصفقة
void UpdateAdaptiveWeights(bool is_win, int pat_idx) {
    double delta = is_win ? 0.015 : -0.015;
    for(int i = 0; i < TOTAL_ALGOS; i++) {
        if(!g_algo_fired[i]) continue;
        g_w[i] = MathMax(0.30, MathMin(5.0, g_w[i] + delta));
    }

    // تحديث مؤشر النمط
    if(pat_idx >= 0 && pat_idx < 15) {
        if(is_win) g_pt_wins[pat_idx]++;
        // فحص أداء النمط
        if(g_pt_trades[pat_idx] >= 5) {
            double wr = (double)g_pt_wins[pat_idx] / g_pt_trades[pat_idx];
            if(wr < 0.45) g_w[IDX_D1 + pat_idx] = 0.0;
            else if(wr > 0.70) g_w[IDX_D1 + pat_idx] = MathMin(5.0, g_w[IDX_D1 + pat_idx] * 1.5);
        }
    }

    // تحديث إحصائيات النظام
    int ridx = (int)g_regime;
    g_regime_trades[ridx]++;
    if(is_win) g_regime_wins[ridx]++;
    if(g_regime_trades[ridx] >= 20) {
        double rwr = (double)g_regime_wins[ridx] / g_regime_trades[ridx];
        g_regime_blocked[ridx] = (rwr < 0.45);
    }
}

//+------------------------------------------------------------------+
//| § 16 — تنفيذ الصفقات                                             |
//+------------------------------------------------------------------+

// فتح صفقة شراء
bool OpenBuy(double lot, double sl, double tp) {
    if(!trade.Buy(lot, _Symbol, 0, sl, tp, "SUPREME-EA BUY")) {
        Print("❌ خطأ فتح شراء: ", trade.ResultRetcode(),
              " — ", trade.ResultRetcodeDescription());
        return false;
    }
    g_cur_ticket  = trade.ResultOrder();
    g_cur_dir     = 1;
    g_in_trade    = true;
    g_trade_open_t= TimeCurrent();
    g_entry_px    = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
    g_sl_px       = sl;
    g_tp_px       = tp;
    Print("✅ صفقة شراء مفتوحة — تذكرة: ", g_cur_ticket,
          " | دخول: ", DoubleToString(g_entry_px, _Digits),
          " | SL: ", DoubleToString(sl, _Digits),
          " | TP: ", DoubleToString(tp, _Digits));
    return true;
}

// فتح صفقة بيع
bool OpenSell(double lot, double sl, double tp) {
    if(!trade.Sell(lot, _Symbol, 0, sl, tp, "SUPREME-EA SELL")) {
        Print("❌ خطأ فتح بيع: ", trade.ResultRetcode(),
              " — ", trade.ResultRetcodeDescription());
        return false;
    }
    g_cur_ticket  = trade.ResultOrder();
    g_cur_dir     = -1;
    g_in_trade    = true;
    g_trade_open_t= TimeCurrent();
    g_entry_px    = SymbolInfoDouble(_Symbol, SYMBOL_BID);
    g_sl_px       = sl;
    g_tp_px       = tp;
    Print("✅ صفقة بيع مفتوحة — تذكرة: ", g_cur_ticket,
          " | دخول: ", DoubleToString(g_entry_px, _Digits),
          " | SL: ", DoubleToString(sl, _Digits),
          " | TP: ", DoubleToString(tp, _Digits));
    return true;
}

// محاولة فتح صفقة بعد جميع الفحوصات
void TryEnterTrade(int dir, double conf) {
    if(dir == 0 || !IsSpreadOK() || !IsTradingTime())  return;
    if(g_in_trade)                                      return;
    if(TimeCurrent() < g_cooldown_until)                return;
    if(TimeCurrent() < g_pause_until)                   return;
    if(IsRegimeBlocked())                               return;
    if(conf < GetMinConf())                             return;
    if(MathAbs(g_last_score) < GetMinScore())          return;

    // حارس الاتجاه
    int trend = GetTrendGuard();
    if(trend ==  1 && dir < 0) return; // STRONG_UP — يمنع SELL
    if(trend == -1 && dir > 0) return; // STRONG_DOWN — يمنع BUY

    // SR Zone — خارج المناطق = لا تداول
    if(!g_in_sr) return;

    double atr   = g_atr_val;
    if(atr == 0) atr = 0.0010;
    double lot   = NormalizeLot(GetConfLot(conf) * InpMaxLotMult / 2.0);

    double ask   = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
    double bid   = SymbolInfoDouble(_Symbol, SYMBOL_BID);
    int    digits= (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);

    if(dir > 0) {
        double sl = NormalizeDouble(ask - InpSL_ATR * atr, digits);
        double tp = NormalizeDouble(ask + InpTP_ATR * atr, digits);
        OpenBuy(lot, sl, tp);
    } else {
        double sl = NormalizeDouble(bid + InpSL_ATR * atr, digits);
        double tp = NormalizeDouble(bid - InpTP_ATR * atr, digits);
        OpenSell(lot, sl, tp);
    }
}

// فحص حالة الصفقة المفتوحة
void MonitorPositions() {
    if(!g_in_trade) return;
    bool found = false;
    for(int i = PositionsTotal() - 1; i >= 0; i--) {
        ulong ticket = PositionGetTicket(i);
        if(!PositionSelectByTicket(ticket)) continue;
        if(PositionGetString(POSITION_SYMBOL)  != _Symbol)       continue;
        if(PositionGetInteger(POSITION_MAGIC)  != SUPREME_MAGIC)  continue;
        found = true;
        break;
    }
    if(!found) g_in_trade = false;
}

//+------------------------------------------------------------------+
//| § 17 — سجلات CSV                                                 |
//+------------------------------------------------------------------+

// تسجيل الصفقة في ملف CSV
void LogTrade(ulong deal, double profit, bool is_win) {
    string path = "SUPREME-EA\\supreme_trades.csv";
    int fh = FileOpen(path, FILE_WRITE|FILE_CSV|FILE_ANSI|FILE_SHARE_READ|FILE_APPEND, ',');
    if(fh == INVALID_HANDLE) return;

    int dur = (int)((TimeCurrent() - g_trade_open_t) / 60);
    FileWrite(fh,
        TimeToString(TimeCurrent()), (long)deal, _Symbol,
        (g_cur_dir > 0 ? "BUY" : "SELL"),
        DoubleToString(g_entry_px, _Digits),
        DoubleToString(g_sl_px,    _Digits),
        DoubleToString(g_tp_px,    _Digits),
        DoubleToString(g_kelly_lot,2),
        DoubleToString(g_last_conf, 1),
        DoubleToString(g_last_score,2),
        EnumToString(g_regime),
        DoubleToString(g_hurst, 3),
        (g_sA1_last != 0 ? "1" : "0"),
        g_last_pattern,
        (g_in_sr ? "داخل" : "خارج"),
        DoubleToString(g_last_brk_px, _Digits),
        g_last_brk_txt,
        (is_win ? "WIN" : "LOSS"),
        DoubleToString(profit, 2),
        dur
    );
    FileClose(fh);
}

// تسجيل الأداء في ملف CSV
void LogPerformance() {
    string path = "SUPREME-EA\\supreme_performance.csv";
    int fh = FileOpen(path, FILE_WRITE|FILE_CSV|FILE_ANSI|FILE_SHARE_READ|FILE_APPEND, ',');
    if(fh == INVALID_HANDLE) return;

    double wr = (g_total_trades > 0) ? 100.0 * g_total_wins / g_total_trades : 0;
    int    active_zones = 0;
    for(int i = 0; i < (int)MathMin(g_zone_cnt, MAX_ZONES); i++)
        if(g_zones[i].active) active_zones++;

    FileWrite(fh,
        TimeToString(TimeCurrent()),
        g_total_trades, g_total_wins,
        DoubleToString(wr,    1),
        DoubleToString(g_total_pnl, 2),
        DoubleToString(g_kelly_lot, 2),
        active_zones
    );
    FileClose(fh);
}

// تسجيل الإشارة
void LogSignal(int dir, double conf, double score) {
    string path = "SUPREME-EA\\supreme_signals.csv";
    int fh = FileOpen(path, FILE_WRITE|FILE_CSV|FILE_ANSI|FILE_SHARE_READ|FILE_APPEND, ',');
    if(fh == INVALID_HANDLE) return;

    FileWrite(fh,
        TimeToString(TimeCurrent()), _Symbol,
        DoubleToString(score, 2),
        DoubleToString(conf,  1),
        EnumToString(g_regime),
        (dir > 0 ? "BUY" : dir < 0 ? "SELL" : "NEUTRAL"),
        (g_in_sr ? "داخل منطقة" : "خارج"),
        g_last_brk_txt,
        g_last_pattern
    );
    FileClose(fh);
}

//+------------------------------------------------------------------+
//| § 18 — لوحة التحكم العربية                                       |
//+------------------------------------------------------------------+

// دالة مساعدة لإنشاء/تحديث تسمية نصية
void SetLabel(string name, string txt, int x, int y, color col, int font_size = 9) {
    if(ObjectFind(0, name) < 0) {
        ObjectCreate(0, name, OBJ_LABEL, 0, 0, 0);
        ObjectSetInteger(0, name, OBJPROP_CORNER,  CORNER_LEFT_UPPER);
        ObjectSetInteger(0, name, OBJPROP_XDISTANCE, x);
        ObjectSetInteger(0, name, OBJPROP_YDISTANCE, y);
        ObjectSetString (0, name, OBJPROP_FONT,    "Arial");
        ObjectSetInteger(0, name, OBJPROP_FONTSIZE, font_size);
    }
    ObjectSetString (0, name, OBJPROP_TEXT,  txt);
    ObjectSetInteger(0, name, OBJPROP_COLOR, col);
}

// تهيئة خلفية اللوحة
void InitDashboard() {
    bool is_testing = (bool)MQLInfoInteger(MQL_TESTER);
    bool is_visual  = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
    if(!InpShowPanel || (is_testing && !is_visual)) return;

    string bg = PANEL_PREFIX + "BG";
    ObjectCreate(0, bg, OBJ_RECTANGLE_LABEL, 0, 0, 0);
    ObjectSetInteger(0, bg, OBJPROP_CORNER,      CORNER_LEFT_UPPER);
    ObjectSetInteger(0, bg, OBJPROP_XDISTANCE,   8);
    ObjectSetInteger(0, bg, OBJPROP_YDISTANCE,   25);
    ObjectSetInteger(0, bg, OBJPROP_XSIZE,        295);
    ObjectSetInteger(0, bg, OBJPROP_YSIZE,        420);
    ObjectSetInteger(0, bg, OBJPROP_BGCOLOR,      clrMidnightBlue);
    ObjectSetInteger(0, bg, OBJPROP_BORDER_TYPE,  BORDER_FLAT);
    ObjectSetInteger(0, bg, OBJPROP_COLOR,        clrSteelBlue);
    ObjectSetInteger(0, bg, OBJPROP_BACK,         false);
}

// تحديث اللوحة كل تيك
void UpdateDashboard() {
    bool is_testing = (bool)MQLInfoInteger(MQL_TESTER);
    bool is_visual  = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
    if(!InpShowPanel || (is_testing && !is_visual)) return;

    // تحديث كل 250ms فقط
    datetime now_ms = (datetime)(GetMicrosecondCount() / 1000);
    if(now_ms - g_dash_last_ms < 250) return;
    g_dash_last_ms = now_ms;

    string reg_txt = "";
    switch(g_regime) {
        case REGIME_TREND:    reg_txt = "TREND 📈";    break;
        case REGIME_RANGE:    reg_txt = "RANGE ↔️";    break;
        case REGIME_VOLATILE: reg_txt = "VOLATILE ⚡"; break;
        default:              reg_txt = "NEUTRAL ➡️";  break;
    }

    color dir_col = (g_last_dir > 0) ? clrLime : (g_last_dir < 0) ? clrRed : clrGray;
    string dir_txt = (g_last_dir > 0) ? "شراء 🟢" : (g_last_dir < 0) ? "بيع 🔴" : "انتظار ⚪";

    // السطر الأول — العنوان
    SetLabel(PANEL_PREFIX+"T0", "🤖 SUPREME-EA v1 | Exness | بوت التداول الذكي",
             14, 30, clrWhite, 9);

    // النظام والحالة
    SetLabel(PANEL_PREFIX+"T1",
             "الحالة: 🟢 نشط  |  النظام: " + reg_txt,
             14, 50, clrSkyBlue);

    // Hurst و ATR
    SetLabel(PANEL_PREFIX+"T2",
             "Hurst: " + DoubleToString(g_hurst,2) +
             "  |  ATR: " + DoubleToString(g_atr_val, _Digits+1),
             14, 68, clrLightGray);

    // TVE و Kalman
    string tve_txt = (g_tve_sigma < 3.0) ? "TVE: 🔥 نشط" : "TVE: ⏳ ترقب";
    SetLabel(PANEL_PREFIX+"T3",
             tve_txt + "  |  Kalman Δ: " + DoubleToString(g_kalman_delta, _Digits+1),
             14, 86, clrLightGray);

    // ─── آخر تحليل ───
    SetLabel(PANEL_PREFIX+"T4", "────── آخر تحليل ──────", 14, 106, clrSteelBlue);

    SetLabel(PANEL_PREFIX+"T5",
             "CE: " + g_ce_txt + "  |  SR: " + (g_in_sr ? "✅ داخل منطقة" : "⬜ خارج"),
             14, 122, clrLightGray);

    SetLabel(PANEL_PREFIX+"T6",
             "RSI: " + DoubleToString(g_last_rsi_v,1) +
             "  |  MACD: " + (g_macd_cross ? "تقاطع صاعد ✅" : "---"),
             14, 138, clrLightGray);

    int    pat_wins_pct = 0;
    if(g_last_pat_idx >= 0 && g_pt_trades[g_last_pat_idx] > 0)
        pat_wins_pct = (int)(100.0 * g_pt_wins[g_last_pat_idx] / g_pt_trades[g_last_pat_idx]);
    SetLabel(PANEL_PREFIX+"T7",
             "نمط: " + g_last_pattern + " (" + IntegerToString(pat_wins_pct) + "%) ",
             14, 154, clrLightGray);

    SetLabel(PANEL_PREFIX+"T8",
             "النقاط: " + DoubleToString(g_last_score,1) +
             "/10  |  الثقة: " + DoubleToString(g_last_conf,0) + "%  |  قرار: " + dir_txt,
             14, 170, dir_col, 9);

    // ─── الصفقة الحالية ───
    SetLabel(PANEL_PREFIX+"T9", "────── الصفقة الحالية ──────", 14, 192, clrSteelBlue);

    if(g_in_trade) {
        string trade_type = (g_cur_dir > 0) ? "شراء" : "بيع";
        double cur_pnl = 0;
        for(int i = PositionsTotal()-1; i >= 0; i--) {
            ulong tk = PositionGetTicket(i);
            if(!PositionSelectByTicket(tk)) continue;
            if(PositionGetInteger(POSITION_MAGIC) != SUPREME_MAGIC) continue;
            cur_pnl = PositionGetDouble(POSITION_PROFIT);
            break;
        }
        int mins = (int)((TimeCurrent() - g_trade_open_t) / 60);
        color pnl_col = (cur_pnl >= 0) ? clrLime : clrRed;

        SetLabel(PANEL_PREFIX+"T10",
                 "نوع: " + trade_type + "  |  دخول: " + DoubleToString(g_entry_px, _Digits),
                 14, 208, clrWhite);
        SetLabel(PANEL_PREFIX+"T11",
                 "SL: " + DoubleToString(g_sl_px, _Digits) +
                 "  |  TP: " + DoubleToString(g_tp_px, _Digits),
                 14, 224, clrLightGray);
        SetLabel(PANEL_PREFIX+"T12",
                 "الربح: " + DoubleToString(cur_pnl, 2) + "$  |  مضى: " +
                 IntegerToString(mins) + " دقيقة",
                 14, 240, pnl_col);
    } else {
        SetLabel(PANEL_PREFIX+"T10", "لا توجد صفقة مفتوحة", 14, 208, clrGray);
        SetLabel(PANEL_PREFIX+"T11", "", 14, 224, clrGray);
        SetLabel(PANEL_PREFIX+"T12", "", 14, 240, clrGray);
    }

    // ─── إحصائيات اليوم ───
    SetLabel(PANEL_PREFIX+"T13", "────── إحصائيات اليوم ──────", 14, 262, clrSteelBlue);

    int td_wr = (g_td_trades > 0) ? (int)(100.0 * g_td_wins / g_td_trades) : 0;
    SetLabel(PANEL_PREFIX+"T14",
             "صفقات:" + IntegerToString(g_td_trades) +
             " | فوز:" + IntegerToString(g_td_wins) +
             " | خسارة:" + IntegerToString(g_td_trades - g_td_wins) +
             " | نسبة:" + IntegerToString(td_wr) + "%",
             14, 278, clrLightGray);

    color pnl_day_col = (g_td_pnl >= 0) ? clrLime : clrRed;
    SetLabel(PANEL_PREFIX+"T15",
             "إجمالي الربح: " + DoubleToString(g_td_pnl, 2) + "$",
             14, 294, pnl_day_col);

    // مناطق SR نشطة
    int act_z = 0, sup_z = 0, res_z = 0;
    for(int i = 0; i < (int)MathMin(g_zone_cnt, MAX_ZONES); i++) {
        if(!g_zones[i].active) continue;
        act_z++;
        if(g_zones[i].zone_type == ZONE_SUPPORT) sup_z++;
        else res_z++;
    }
    SetLabel(PANEL_PREFIX+"T16",
             "مناطق SR: " + IntegerToString(act_z) +
             " (دعم:" + IntegerToString(sup_z) +
             " | مقاومة:" + IntegerToString(res_z) + ")",
             14, 312, clrLightGray);

    SetLabel(PANEL_PREFIX+"T17",
             "آخر كسر: " + g_last_brk_txt + " عند " +
             DoubleToString(g_last_brk_px, _Digits),
             14, 328, clrYellow);

    // توقف مؤقت؟
    if(TimeCurrent() < g_pause_until) {
        int rem = (int)((g_pause_until - TimeCurrent()) / 60);
        SetLabel(PANEL_PREFIX+"T18",
                 "⛔ متوقف — يستأنف بعد " + IntegerToString(rem) + " دقيقة",
                 14, 348, clrRed);
    } else {
        SetLabel(PANEL_PREFIX+"T18", "", 14, 348, clrGray);
    }

    ChartRedraw(0);
}

//+------------------------------------------------------------------+
//| § 19 — OnInit                                                    |
//+------------------------------------------------------------------+
int OnInit() {
    Print("=== SUPREME-EA v1 | يبدأ التشغيل ===");

    // تحقق من الحساب
    ENUM_ACCOUNT_TRADE_MODE mode = (ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE);
    bool is_demo = (mode == ACCOUNT_TRADE_MODE_DEMO);
    Print("الحساب: ", is_demo ? "تجريبي" : "حقيقي");
    Print("الرصيد: ", AccountInfoDouble(ACCOUNT_BALANCE), " USD");
    Print("الرافعة: 1:", AccountInfoInteger(ACCOUNT_LEVERAGE));
    Print("العملة: ", AccountInfoString(ACCOUNT_CURRENCY));

    // تحقق من نوع الحساب (هيدجينج)
    ENUM_ACCOUNT_MARGIN_MODE mm = (ENUM_ACCOUNT_MARGIN_MODE)AccountInfoInteger(ACCOUNT_MARGIN_MODE);
    if(mm != ACCOUNT_MARGIN_MODE_RETAIL_HEDGING)
        Print("⚠️ تحذير: الحساب ليس هيدجينج");

    // تحقق من الرمز
    if(!SymbolSelect(InpSymbol, true)) {
        Print("❌ الرمز غير موجود: ", InpSymbol);
        return INIT_FAILED;
    }

    // تحقق من أدنى لوت
    double min_lot = SymbolInfoDouble(InpSymbol, SYMBOL_VOLUME_MIN);
    if(InpBaseLot < min_lot) {
        Print("⚠️ اللوت الأساسي أصغر من الحد الأدنى (", min_lot, ") — سيُستخدم الحد الأدنى");
    }

    // تهيئة مقابض المؤشرات
    g_rsi_h    = iRSI   (_Symbol, PERIOD_M5, InpRSI_Period, PRICE_CLOSE);
    g_atr_h    = iATR   (_Symbol, PERIOD_M5, 14);
    g_maFast_h = iMA    (_Symbol, PERIOD_M5, InpEMA_Fast, 0, MODE_EMA, PRICE_CLOSE);
    g_maSlow_h = iMA    (_Symbol, PERIOD_M5, InpEMA_Slow, 0, MODE_EMA, PRICE_CLOSE);
    g_macd_h   = iMACD  (_Symbol, PERIOD_M5, 12, 26, 9, PRICE_CLOSE);
    g_bb_h     = iBands (_Symbol, PERIOD_M5, 20, 0, 2.0, PRICE_CLOSE);
    g_atrCE_h  = iATR   (_Symbol, PERIOD_M5, InpCE_ATR);
    g_e5m1_h   = iMA    (_Symbol, PERIOD_M1, 5,  0, MODE_EMA, PRICE_CLOSE);
    g_e21m1_h  = iMA    (_Symbol, PERIOD_M1, 21, 0, MODE_EMA, PRICE_CLOSE);

    if(g_rsi_h  == INVALID_HANDLE || g_atr_h   == INVALID_HANDLE ||
       g_maFast_h == INVALID_HANDLE || g_maSlow_h == INVALID_HANDLE ||
       g_macd_h == INVALID_HANDLE || g_bb_h    == INVALID_HANDLE ||
       g_atrCE_h== INVALID_HANDLE || g_e5m1_h  == INVALID_HANDLE ||
       g_e21m1_h== INVALID_HANDLE) {
        Print("❌ فشل في إنشاء مقبض مؤشر");
        return INIT_FAILED;
    }

    // تهيئة بنى البيانات
    KalmanInit();
    ChandelierInit();

    // تهيئة مخزن TVE
    for(int i = 0; i < TVE_BUF_SIZE; i++) { g_tve_buf[i].price = 0; g_tve_buf[i].time_ms = 0; }
    // تهيئة مصفوفات عادية
    ArrayInitialize(g_atr_hist,      0.0);
    ArrayInitialize(g_spread_hist,   0.0);
    ArrayInitialize(g_pt_trades,     0);
    ArrayInitialize(g_pt_wins,       0);
    ArrayInitialize(g_regime_trades, 0);
    ArrayInitialize(g_regime_wins,   0);
    // تهيئة مناطق SR
    for(int i = 0; i < MAX_ZONES; i++) {
        g_zones[i].active      = false;
        g_zones[i].is_flipped  = false;
        g_zones[i].touch_count = 0;
        g_zones[i].obj_box_name   = "";
        g_zones[i].obj_label_name = "";
    }
    // تهيئة حالة النظام المحظور
    for(int i = 0; i < 4; i++) g_regime_blocked[i] = false;

    // تحميل الأوزان المحفوظة
    InitWeights();
    LoadWeights();

    // تهيئة CTrade
    trade.SetExpertMagicNumber(SUPREME_MAGIC);
    trade.SetDeviationInPoints(10);
    trade.SetTypeFilling(ORDER_FILLING_IOC);

    // إنشاء مجلد السجلات
    FolderCreate("SUPREME-EA");

    // تهيئة الـ Spread
    double init_spread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD) * _Point;
    for(int i = 0; i < 20; i++) g_spread_hist[i] = init_spread;
    g_avg_spread = init_spread;

    // تهيئة اليوم
    MqlDateTime dt;
    TimeToStruct(TimeCurrent(), dt);
    dt.hour = 0; dt.min = 0; dt.sec = 0;
    g_td_date = StructToTime(dt);

    // تهيئة الـ TVE — ضبط الوقت لمنع الانحلال الفوري لـ sigma
    g_tps_start    = (datetime)(GetMicrosecondCount() / 1000);
    g_tve_last_ms  = (datetime)(GetMicrosecondCount() / 1000);

    // بناء اللوحة
    InitDashboard();
    UpdateDashboard();

    // ضبط التايمر
    EventSetMillisecondTimer(100);

    Print("✅ SUPREME-EA v1 جاهز | الرمز: ", InpSymbol,
          " | اللوت: ", InpBaseLot,
          " | وضع: ", InpDemoMode ? "تجريبي" : "حقيقي");
    return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| § 20 — OnTick                                                    |
//+------------------------------------------------------------------+
void OnTick() {
    // تحديث مخزن التيكات
    TVE_Update();
    KalmanUpdate(SymbolInfoDouble(_Symbol, SYMBOL_BID));
    UpdateSpread();

    // A4 — حارس الـ Spread
    if(!IsSpreadOK()) return;

    // مراقبة الصفقات المفتوحة
    MonitorPositions();

    // فحص SEE في كل تيك
    if(SEE_ShouldFire()) {
        TryEnterTrade(g_see_dir, g_see_conf);
    }

    // فحص شمعة جديدة
    datetime cur_candle = iTime(_Symbol, InpTF, 0);
    bool new_candle = (cur_candle != g_last_candle);

    if(new_candle) {
        g_last_candle = cur_candle;

        // تحديث منطقة SR
        SRZones_Update();

        // تحديث Chandelier
        ChandelierUpdate();

        // تحديث النظام
        UpdateRegime();

        // تشغيل التحليل الكامل
        int  dir  = 0;
        double conf = 0;
        double score = RunAnalysis(dir, conf);

        // تسجيل الإشارة
        LogSignal(dir, conf, score);

        // جدولة SEE
        if(!g_in_trade && dir != 0 && conf >= 70.0)
            SEE_Schedule(conf, dir);

        // دخول عند conf عادي (لا SEE)
        if(!g_see_pending)
            TryEnterTrade(dir, conf);

        // تحديث يوم جديد
        MqlDateTime dt;
        TimeToStruct(TimeCurrent(), dt);
        dt.hour = 0; dt.min = 0; dt.sec = 0;
        datetime today = StructToTime(dt);
        if(today != g_td_date) {
            g_td_date = today; g_td_trades = 0; g_td_wins = 0; g_td_pnl = 0;
        }
    }

    // تحديث اللوحة كل تيك
    UpdateDashboard();
}

//+------------------------------------------------------------------+
//| § 21 — OnTimer (100ms)                                           |
//+------------------------------------------------------------------+
void OnTimer() {
    // فحص SEE
    if(SEE_ShouldFire())
        TryEnterTrade(g_see_dir, g_see_conf);

    // فحص كسر SR في الوقت الفعلي
    CheckBreakouts();

    // تحديث اللوحة
    UpdateDashboard();
}

//+------------------------------------------------------------------+
//| § 22 — OnTradeTransaction                                        |
//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest     &request,
                        const MqlTradeResult      &result) {
    if(trans.type != TRADE_TRANSACTION_DEAL_ADD) return;
    HistorySelect(TimeCurrent() - 86400, TimeCurrent());
    if(!HistoryDealSelect(trans.deal)) return;

    long magic = (long)HistoryDealGetInteger(trans.deal, DEAL_MAGIC);
    if(magic != SUPREME_MAGIC) return;

    ENUM_DEAL_ENTRY deal_entry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(trans.deal, DEAL_ENTRY);
    if(deal_entry != DEAL_ENTRY_OUT) return;

    double profit = HistoryDealGetDouble(trans.deal, DEAL_PROFIT)
                  + HistoryDealGetDouble(trans.deal, DEAL_SWAP)
                  + HistoryDealGetDouble(trans.deal, DEAL_COMMISSION);
    bool is_win = (profit > 0);

    // تحديث الإحصائيات
    UpdateKellyStats(is_win, profit);
    UpdateAdaptiveWeights(is_win, g_last_pat_idx);
    SaveWeights();

    // إحصائيات اليوم
    g_td_trades++;
    if(is_win) g_td_wins++;
    g_td_pnl += profit;

    // سلسلة الخسائر
    if(is_win) {
        g_loss_streak = 0;
    } else {
        g_loss_streak++;
        if(g_loss_streak >= InpMaxLoss) {
            g_pause_until = TimeCurrent() + (datetime)(InpPauseMins * 60);
            Print("⛔ إيقاف مؤقت لـ ", InpPauseMins, " دقيقة | خسائر متتالية: ", g_loss_streak);
        }
    }

    // Cooldown بعد الإغلاق
    g_cooldown_until = TimeCurrent() + (datetime)(2 * PeriodSeconds(InpTF));
    g_in_trade       = false;

    // تسجيل
    LogTrade(trans.deal, profit, is_win);
    LogPerformance();

    Print(is_win ? "✅ فوز: +" : "❌ خسارة: ",
          DoubleToString(profit, 2), "$ | سلسلة خسائر: ", g_loss_streak);
}

//+------------------------------------------------------------------+
//| § 23 — OnDeinit                                                  |
//+------------------------------------------------------------------+
void OnDeinit(const int reason) {
    EventKillTimer();

    // حفظ الأوزان
    SaveWeights();

    // تنظيف مؤشرات SR
    SRZones_Cleanup();

    // إزالة اللوحة
    ObjectsDeleteAll(0, PANEL_PREFIX);

    // تحرير مقابض المؤشرات
    if(g_rsi_h    != INVALID_HANDLE) IndicatorRelease(g_rsi_h);
    if(g_atr_h    != INVALID_HANDLE) IndicatorRelease(g_atr_h);
    if(g_maFast_h != INVALID_HANDLE) IndicatorRelease(g_maFast_h);
    if(g_maSlow_h != INVALID_HANDLE) IndicatorRelease(g_maSlow_h);
    if(g_macd_h   != INVALID_HANDLE) IndicatorRelease(g_macd_h);
    if(g_bb_h     != INVALID_HANDLE) IndicatorRelease(g_bb_h);
    if(g_atrCE_h  != INVALID_HANDLE) IndicatorRelease(g_atrCE_h);
    if(g_e5m1_h   != INVALID_HANDLE) IndicatorRelease(g_e5m1_h);
    if(g_e21m1_h  != INVALID_HANDLE) IndicatorRelease(g_e21m1_h);

    // تقرير ختامي
    double wr = (g_total_trades > 0) ? 100.0 * g_total_wins / g_total_trades : 0;
    Print("═══ تقرير SUPREME-EA v1 ═══");
    Print("إجمالي الصفقات: ", g_total_trades);
    Print("الفائزة: ", g_total_wins, " | الخاسرة: ", g_total_trades - g_total_wins);
    Print("نسبة الفوز: ", DoubleToString(wr, 1), "%");
    Print("إجمالي الربح: ", DoubleToString(g_total_pnl, 2), " USD");
    Print("Kelly Lot: ", DoubleToString(g_kelly_lot, 2));
    Print("النظام الأخير: ", EnumToString(g_regime));
    Print("Hurst: ", DoubleToString(g_hurst, 3));
    Print("═══════════════════════════");
}
//+------------------------------------------------------------------+
