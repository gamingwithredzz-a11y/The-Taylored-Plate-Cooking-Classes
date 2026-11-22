// Taylored Eats Manager HUD v0.2 — server-demo orders, no real L$.
// Drop into one prim; attach the object to a HUD attachment point.
// Each authorized manager has a separate 64-character secret. Never publish it.
string BASE = "https://taylored-eats.onrender.com";
list MANAGERS = ["2cf44513-e9e7-48f2-b717-b8ffe5117a37", "436b1c38-e897-491a-80fb-6a7d5c4864c0"];
string secret;
integer cursor;
integer queueIndex;
integer channel;
integer listener;
integer configuring;
integer muted;
integer retries;
integer elapsed;
key pending;
string pendingKind;
string selected;
string orderID;
string orderStatus;
list seen;
vector GOLD = <0.83, 0.67, 0.37>;

integer authorized()
{
    return llListFindList(MANAGERS, [(string)llGetOwner()]) != -1;
}
integer ready()
{
    return authorized() && llGetAttached() && llStringLength(secret) == 64;
}
paint(string connection)
{
    string label = "TAYLORED EATS\nMANAGER • DEMO\n" + connection;
    if (orderID != "")
        label += "\n#" + llGetSubString(orderID, 0, 7) + " • " + orderStatus
          + "\n" + llJsonGetValue(selected, ["method"]) + " • L$" + llJsonGetValue(selected, ["total"]);
    llSetText(label + "\nTouch for order controls", GOLD, 1.0);
}
request(string path, string method, string body, string kind)
{
    if (!ready() || pending != NULL_KEY) return;
    list headers = [HTTP_METHOD, method, HTTP_MIMETYPE, "application/json",
        HTTP_BODY_MAXLENGTH, 12000, HTTP_CUSTOM_HEADER, "Authorization", "Bearer " + secret];
    if (method == "POST") headers += [HTTP_CUSTOM_HEADER, "Idempotency-Key", (string)llGenerateKey()];
    pendingKind = kind;
    pending = llHTTPRequest(BASE + path, headers, body);
    elapsed = 0;
    if (pending == NULL_KEY) { retries = 6; paint("HTTP throttle • retrying"); }
}
details()
{
    if (orderID == "") { llOwnerSay("No order selected. Touch Queue."); return; }
    llOwnerSay("DEMO ORDER #" + llGetSubString(orderID, 0, 7) + " • " + orderStatus
        + "\nCustomer demo ID: " + llJsonGetValue(selected, ["customer"])
        + "\n" + llJsonGetValue(selected, ["summary"]));
    llOwnerSay("Method: " + llJsonGetValue(selected, ["method"])
        + "\nLocation: " + llJsonGetValue(selected, ["location"])
        + "\nTotal: L$" + llJsonGetValue(selected, ["total"])
        + "\nCustomer notes: " + llJsonGetValue(selected, ["notes"]));
    if (llJsonGetValue(selected, ["truncated"]) == JSON_TRUE)
        llOwnerSay("Large order: item summary truncated. Review full order with the customer before fulfilling.");
}
selectOrder(string value)
{
    selected = value;
    orderID = llJsonGetValue(value, ["id"]);
    orderStatus = llJsonGetValue(value, ["status"]);
    paint("Connected");
}
menu()
{
    if (listener) llListenRemove(listener);
    channel = -100000 - (integer)llFrand(1000000000.0);
    listener = llListen(channel, "", llGetOwner(), "");
    configuring = FALSE;
    llDialog(llGetOwner(), "Taylored Eats Manager HUD\nDEMO orders only; no real payments.\n"
       + "Queue selects the first active order; Next moves through active orders.\nAdvance moves the selected order one step; all managers see the change.",
       ["Queue", "Next", "Details", "Advance", "Refresh", "Mute", "Setup", "Close"], channel);
}
boot()
{
    pending = NULL_KEY;
    if (!authorized()) { secret = ""; paint("Unauthorized owner"); llSetTimerEvent(0.0); return; }
    string storedOwner = llLinksetDataRead("te.manager.owner");
    if (storedOwner != (string)llGetOwner())
    {
        llLinksetDataDelete("te.manager.secret");
        llLinksetDataDelete("te.manager.cursor");
        llLinksetDataWrite("te.manager.owner", (string)llGetOwner());
    }
    secret = llLinksetDataRead("te.manager.secret");
    cursor = (integer)llLinksetDataRead("te.manager.cursor");
    if (!llGetAttached()) { paint("Attach to your HUD to receive alerts"); llSetTimerEvent(0.0); return; }
    llSetTimerEvent(10.0);
    if (llStringLength(secret) != 64) paint("Touch Setup to connect");
    else { paint("Connecting"); request("/staff/feed?after=" + (string)cursor, "GET", "", "feed"); }
}
default
{
    state_entry()
    {
        llSetObjectName("Taylored Eats Manager HUD");
        llSetColor(<0.025,0.025,0.03>, ALL_SIDES);
        llSetPrimitiveParams([PRIM_FULLBRIGHT, ALL_SIDES, TRUE]);
        boot();
    }
    attach(key avatar) { boot(); }
    on_rez(integer parameter) { llResetScript(); }
    changed(integer change) { if (change & CHANGED_OWNER) { llLinksetDataReset(); llResetScript(); } }
    touch_start(integer count)
    {
        if (llDetectedKey(0) != llGetOwner() || !authorized()) return;
        if (!llGetAttached()) { llOwnerSay("Attach this object to a HUD point first. Rezzed objects do not receive alerts."); return; }
        menu();
    }
    listen(integer c, string name, key who, string message)
    {
        if (who != llGetOwner() || c != channel || !authorized()) return;
        if (configuring)
        {
            configuring = FALSE;
            message = llToLower(llStringTrim(message, STRING_TRIM));
            integer i;
            integer valid = llStringLength(message) == 64;
            for (i=0; i<llStringLength(message); ++i)
                if (llSubStringIndex("0123456789abcdef", llGetSubString(message,i,i)) < 0) valid = FALSE;
            if (!valid) { llOwnerSay("Use your private 64-character manager key."); return; }
            secret = message;
            llLinksetDataWrite("te.manager.secret", secret);
            pending = NULL_KEY; retries = 0;
            request("/staff/feed?after=" + (string)cursor, "GET", "", "feed");
            return;
        }
        if (message == "Setup") { configuring = TRUE; llTextBox(llGetOwner(), "Paste YOUR private manager key. Never share it or put it in the website URL.", channel); }
        else if (message == "Queue") { queueIndex=0; request("/staff/queue?index=0", "GET", "", "queue"); }
        else if (message == "Next") { ++queueIndex; request("/staff/queue?index="+(string)queueIndex, "GET", "", "queue"); }
        else if (message == "Details") details();
        else if (message == "Refresh") request("/staff/queue?index="+(string)queueIndex, "GET", "", "queue");
        else if (message == "Mute") { muted = !muted; llOwnerSay("HUD chat alerts muted: " + (string)muted); }
        else if (message == "Advance" && orderID != "")
            request("/staff/orders/"+orderID+"/advance", "POST", llList2Json(JSON_OBJECT,["expectedStatus",orderStatus]), "advance");
        else if (message == "Close") { llListenRemove(listener); listener=0; }
    }
    timer()
    {
        if (!ready()) return;
        if (pending != NULL_KEY)
        {
            elapsed += 10;
            if (elapsed < 80) return;
            pending = NULL_KEY;
            retries = 6;
            paint("Connection timeout • retrying");
        }
        if (retries > 0) { --retries; return; }
        request("/staff/feed?after=" + (string)cursor, "GET", "", "feed");
    }
    http_response(key id, integer status, list metadata, string body)
    {
        if (id != pending || !ready()) return;
        pending = NULL_KEY;
        if (status != 200)
        {
            retries = 6;
            paint("Connection error " + (string)status);
            if (status == 409) { llOwnerSay("Another manager updated this order. Refresh before advancing."); }
            else if (status == 401) llOwnerSay("Manager connection refused. Check your private Setup key.");
            return;
        }
        retries = 0;
        string value = llJsonGetValue(body,["order"]);
        if (pendingKind == "feed")
        {
            integer next = (integer)llJsonGetValue(body,["cursor"]);
            if (llJsonGetValue(body,["reset"]) == JSON_TRUE)
                llOwnerSay("Demo server data reset. Your alert cursor was restarted.");
            if (value != JSON_NULL && value != JSON_INVALID)
            {
                string oid = llJsonGetValue(value,["id"]);
                string st = llJsonGetValue(value,["status"]);
                if (st == "New" && llListFindList(seen,[oid]) == -1)
                {
                    seen += [oid]; if (llGetListLength(seen)>64) seen=llDeleteSubList(seen,0,0);
                    selectOrder(value);
                    if (!muted) { llOwnerSay("NEW TAYLORED EATS DEMO ORDER"); details(); }
                }
                else if (oid == orderID) selectOrder(value);
            }
            cursor = next;
            llLinksetDataWrite("te.manager.cursor", (string)cursor);
            paint("Connected");
        }
        else if (value != JSON_NULL && value != JSON_INVALID) { selectOrder(value); details(); }
        else { selected=""; orderID=""; orderStatus=""; paint("No active demo orders"); }
    }
}



