#!/usr/bin/env python3
"""
PO WebSocket Trade Tester — Termux/Android
يشغّل من Termux مباشرة على الجهاز بنفس IP المتصفح
"""

import websocket
import threading
import time
import json
import sys

# ══════════════════════════════════════════════
#  ضع الكوكيز هنا (من إضافة Cookie Extractor)
# ══════════════════════════════════════════════
COOKIE = (
    "ci_session=a%3A4%3A%7Bs%3A10%3A%22session_id%22%3Bs%3A32%3A%224e06a9b6d8f0bb29e68ee1f1a78f0358%22%3Bs%3A10%3A%22ip_address%22%3Bs%3A11%3A%222.90.205.17%22%3Bs%3A10%3A%22user_agent%22%3Bs%3A111%3A%22Mozilla%2F5.0%20%28Linux%3B%20Android%2010%3B%20K%29%20AppleWebKit%2F537.36%20%28KHTML%2C%20like%20Gecko%29%20Chrome%2F137.0.0.0%20Mobile%20Safari%2F537.36%22%3Bs%3A13%3A%22last_activity%22%3Bi%3A1778444647%3B%7D91f353dff223a49580d7e78d2e8c687b; "
    "autologin=a%3A2%3A%7Bs%3A6%3A%22key_id%22%3Bs%3A16%3A%229adbd57bae4b6f76%22%3Bs%3A7%3A%22user_id%22%3Bs%3A9%3A%22130784309%22%3B%7D; "
    "loggedIn=1; po_uuid=68fa4533-2076-40cf-b7cd-e3cd9021d9ae; lang=en"
)

# ══════════════════════════════════════════════
#  إعدادات الصفقة
# ══════════════════════════════════════════════
ASSET   = "EURUSD_otc"   # الزوج
AMOUNT  = 1              # المبلغ بالدولار
ACTION  = "call"         # call = شراء ↑ | put = بيع ↓
IS_DEMO = 1              # 1 = تجريبي | 0 = حقيقي
DURATION= 60             # مدة الصفقة بالثواني

# ══════════════════════════════════════════════
#  الخادم
# ══════════════════════════════════════════════
URL = "wss://demo-api-eu.po.market/socket.io/?EIO=4&transport=websocket"
# للحقيقي: URL = "wss://api-spb.po.market/socket.io/?EIO=4&transport=websocket"

HEADERS = [
    f"Cookie: {COOKIE}",
    "Origin: https://m.pocketoption.com",
    "Referer: https://m.pocketoption.com/en/cabinet/demo-quick-high-low/",
    "User-Agent: Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
]

# ══════════════════════════════════════════════
#  State
# ══════════════════════════════════════════════
state        = {"authed": False, "balance": None, "trade_sent": False}
done_event   = threading.Event()

def ts():
    return time.strftime("%H:%M:%S")

def send_trade(ws):
    req_id = int(time.time() * 1000)
    packet = (
        f'42["openOrder",'
        f'{{"asset":"{ASSET}",'
        f'"amount":{AMOUNT},'
        f'"action":"{ACTION}",'
        f'"isDemo":{IS_DEMO},'
        f'"requestId":{req_id},'
        f'"optionType":100,'
        f'"time":{DURATION}}}]'
    )
    print(f"\n[{ts()}] ═══ إرسال صفقة ═══")
    print(f"  Packet : {packet}")
    ws.send(packet)
    state["trade_sent"] = True

def on_open(ws):
    print(f"[{ts()}] ✓ WebSocket متصل — انتظار EIO handshake…")

def on_message(ws, msg):
    # Decode bytes → str
    if isinstance(msg, (bytes, bytearray)):
        msg = msg.decode('utf-8', errors='ignore')

    # EIO ping → pong
    if msg == "2":
        ws.send("3")
        return

    print(f"[{ts()}] ← {msg[:200]}")

    # EIO handshake → الآن أرسل Socket.IO connect
    if msg.startswith("0{") or msg.startswith("0"):
        try:
            data = json.loads(msg[1:])
            print(f"[{ts()}] ✓ EIO handshake — sid={data.get('sid','?')[:16]}…")
        except:
            pass
        print(f"[{ts()}] → إرسال 40 (Socket.IO connect)")
        ws.send("40")
        return

    # Socket.IO connected confirmation
    if msg == "40" or msg.startswith("40{"):
        print(f"[{ts()}] ✓ Socket.IO متصل — في انتظار successauth…")
        # Auth timeout: إذا ما جاء successauth خلال 5 ثواني → جلسة منتهية
        def _auth_timeout():
            if not state["authed"]:
                print(f"\n[{ts()}] ❌ AUTH timeout — الجلسة منتهية أو غير صالحة")
                print("  الحل: افتح المتصفح → تصفح pocketoption → أعد تصدير الكوكيز")
                done_event.set()
        threading.Timer(5.0, _auth_timeout).start()
        return

    # Socket.IO server disconnect
    if msg == "41" or msg.startswith("41"):
        print(f"\n[{ts()}] ❌ السيرفر قطع الاتصال (41 = Session Rejected)")
        print("  السبب الأكثر احتمالاً: ci_session انتهت صلاحيتها")
        print("  الحل :")
        print("    1) افتح المتصفح على هاتفك")
        print("    2) ادخل pocketoption وسجّل دخولك")
        print("    3) افتح إضافة Cookie Extractor → تبويب ⚡ cURL/WS")
        print("    4) انسخ Cookie String الجديد")
        print("    5) ضعه في متغير COOKIE في هذا السكريبت")
        print("    6) أعد التشغيل")
        done_event.set()
        return

    # Parse 42[event, data]
    if not msg.startswith("42"):
        return
    try:
        arr = json.loads(msg[2:])
        ev   = arr[0] if arr else ""
        data = arr[1] if len(arr) > 1 else {}
    except:
        return

    # Authentication success
    if ev == "successauth":
        state["authed"] = True
        bal = None
        if isinstance(data, dict):
            bal = data.get("balance") or data.get("demo_balance") or data.get("demoBalance")
        print(f"[{ts()}] ✓ AUTH نجح — رصيد={bal}")

        # Send trade 1 second after auth
        threading.Timer(1.0, send_trade, args=[ws]).start()

    # Trade success
    elif ev == "successopenOrder":
        print(f"\n[{ts()}] ══════════════════════════════")
        print(f"[{ts()}] ✅  الصفقة نجحت!")
        print(f"  ID         : {data.get('id','?')}")
        print(f"  Asset      : {data.get('asset','?')}")
        print(f"  Amount     : ${data.get('amount','?')}")
        print(f"  Action     : {data.get('action','?')}")
        print(f"  Profit     : {data.get('percentProfit','?')}%")
        print(f"  Close Time : {data.get('closeTime','?')}")
        print(f"[{ts()}] ══════════════════════════════")
        done_event.set()

    # Trade fail
    elif ev == "failopenOrder":
        err = data.get("error","?") if isinstance(data, dict) else str(data)
        print(f"\n[{ts()}] ❌  الصفقة فشلت: {err}")
        if "min_amount" in str(err):
            mn = data.get("min") if isinstance(data, dict) else "?"
            print(f"  الحد الأدنى: ${mn} — غيّر AMOUNT في السكريبت")
        elif "not_enough" in str(err):
            print(f"  الرصيد غير كافٍ")
        done_event.set()

    # Balance update
    elif ev == "successupdateBalance":
        if isinstance(data, dict):
            b = data.get("demo_balance") or data.get("demoBalance") or data.get("balance")
            if b is not None:
                print(f"[{ts()}] 💰 رصيد محدّث: ${b}")

    # updateAssets — just log once
    elif ev == "updateAssets" and not state["authed"]:
        count = len(data) if isinstance(data, list) else "?"
        print(f"[{ts()}] 📊 updateAssets: {count} أصل")

def on_error(ws, err):
    err_str = str(err)
    # تجاهل close frame — معالجه في on_close
    if "opcode=8" in err_str or "fin=1" in err_str:
        return
    print(f"\n[{ts()}] ✗ خطأ: {err_str}")
    if "403" in err_str:
        if "host_not_allowed" in err_str:
            print("  السبب: CDN يحجب — شغّل من نفس هاتف/جهاز المتصفح")
        elif "ip_not_allowed" in err_str:
            print("  السبب: IP اختلف — افتح المتصفح وسجّل دخولك أولاً")
    elif "401" in err_str:
        print("  السبب: الجلسة انتهت — أعد تصدير الكوكيز")
    done_event.set()

def on_close(ws, code, reason):
    print(f"[{ts()}] ✗ انقطع الاتصال — code={code} reason={reason}")
    done_event.set()

# ══════════════════════════════════════════════
#  Main
# ══════════════════════════════════════════════
print("═" * 50)
print("  PO WebSocket Trade Tester")
print(f"  URL    : {URL.split('?')[0]}")
print(f"  Asset  : {ASSET}")
print(f"  Amount : ${AMOUNT}")
print(f"  Action : {ACTION.upper()} ({'شراء ↑' if ACTION=='call' else 'بيع ↓'})")
print(f"  isDemo : {'تجريبي' if IS_DEMO else '⚠ حقيقي'}")
print(f"  Time   : {DURATION}s")
print("═" * 50)

ws_app = websocket.WebSocketApp(
    URL,
    header=HEADERS,
    on_open=on_open,
    on_message=on_message,
    on_error=on_error,
    on_close=on_close,
)

thread = threading.Thread(
    target=lambda: ws_app.run_forever(ping_interval=0, skip_utf8_validation=True)
)
thread.daemon = True
thread.start()

# انتظر حتى 15 ثانية
done_event.wait(timeout=15)
ws_app.close()
time.sleep(0.3)
print("\nانتهى.")
