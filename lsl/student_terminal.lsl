// Compile as Mono. Keep this script no-modify for students; configure before distribution.
string BASE_URL = "https://YOUR-HOST";
string TOKEN = "REPLACE_WITH_STUDENT_DEVICE_TOKEN";
string TERMINAL = "classroom-1";
// Stride: HTTP request key, avatar key, expiry unix time.
list pending;

tell(key avatar, string message)
{
    integer pos;
    for (pos = 0; pos < llStringLength(message); pos += 200)
        llRegionSayTo(avatar, 0, llGetSubString(message, pos, pos + 199));
}

default
{
    state_entry()
    {
        pending = [];
        llSetTimerEvent(0.0);
    }
    on_rez(integer parameter) { llResetScript(); }
    changed(integer change) { if (change & CHANGED_OWNER) llResetScript(); }
    touch_start(integer total)
    {
        integer touch;
        for (touch = 0; touch < total; ++touch)
        {
            key avatar = llDetectedKey(touch);
            integer busy = FALSE;
            integer i;
            for (i = 0; i < llGetListLength(pending); i += 3)
                if (llList2Key(pending, i + 1) == avatar) busy = TRUE;
            if (busy) tell(avatar, "Your check-in is being processed.");
            else if (llGetListLength(pending) >= 48)
                tell(avatar, "The terminal is busy. Please touch again shortly.");
            else
            {
                string body = llList2Json(JSON_OBJECT, ["request_id", (string)llGenerateKey(),
                    "terminal", TERMINAL, "avatar", (string)avatar,
                    "legacy", llDetectedName(touch), "display", llGetDisplayName(avatar)]);
                key request = llHTTPRequest(BASE_URL + "/v1/check-in",
                    [HTTP_METHOD, "POST", HTTP_MIMETYPE, "application/json",
                    HTTP_CUSTOM_HEADER, "X-Plate-Token", TOKEN, HTTP_BODY_MAXLENGTH, 4096], body);
                if (request == NULL_KEY) tell(avatar, "Unable to connect. Please touch again shortly.");
                else
                {
                    pending += [request, avatar, llGetUnixTime() + 65];
                    llSetTimerEvent(5.0);
                }
            }
        }
    }
    http_response(key request, integer status, list metadata, string body)
    {
        integer i;
        for (i = 0; i < llGetListLength(pending); i += 3)
        {
            if (llList2Key(pending, i) == request)
            {
                key avatar = llList2Key(pending, i + 1);
                pending = llDeleteSubList(pending, i, i + 2);
                if (llGetListLength(pending) == 0) llSetTimerEvent(0.0);
                string message = "The backend did not return a usable response. Please try again or see an instructor.";
                if (status >= 200 && status < 500 && status != 499
                    && llJsonValueType(body, []) == JSON_OBJECT
                    && llJsonValueType(body, ["message"]) == JSON_STRING
                    && (llJsonValueType(body, ["ok"]) == JSON_TRUE || llJsonValueType(body, ["ok"]) == JSON_FALSE))
                    message = llJsonGetValue(body, ["message"]);
                tell(avatar, message);
                return;
            }
        }
    }
    timer()
    {
        integer i;
        for (i = llGetListLength(pending) - 3; i >= 0; i -= 3)
        {
            if (llList2Integer(pending, i + 2) <= llGetUnixTime())
            {
                tell(llList2Key(pending, i + 1), "Check-in request timed out. Please touch again; duplicate check-ins are safe.");
                pending = llDeleteSubList(pending, i, i + 2);
            }
        }
        if (llGetListLength(pending) == 0) llSetTimerEvent(0.0);
    }
}
