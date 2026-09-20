// Compile as Mono. Owner must ALSO be in PLATE_ADMINS on the server.
// Never distribute the admin token or a modifiable copy to students.
string BASE_URL = "https://YOUR-HOST";
string TOKEN = "REPLACE_WITH_ADMIN_DEVICE_TOKEN";
string TERMINAL = "classroom-1";
list ADMINS = []; // Additional allowed avatar UUID strings; backend checks every action too.
key operator;
key request;
integer channel;
integer listener;
integer expires;
integer entering;

integer allowed(key avatar)
{
    return avatar == llGetOwner() || llListFindList(ADMINS, [(string)avatar]) != -1;
}
tell(key avatar, string message)
{
    integer pos;
    for (pos = 0; pos < llStringLength(message); pos += 200)
        llRegionSayTo(avatar, 0, llGetSubString(message, pos, pos + 199));
}
cleanup()
{
    if (listener) llListenRemove(listener);
    listener = 0;
    operator = NULL_KEY;
    request = NULL_KEY;
    entering = FALSE;
    llSetTimerEvent(0.0);
}
menu()
{
    entering = FALSE;
    expires = llGetUnixTime() + 120;
    llDialog(operator, "THE TAYLORED PLATE\nChoose a category. Commands use | between fields. Full reference: README.",
        ["COURSE", "STUDENTS", "ATTENDANCE", "STATIONS", "COHORTS", "SETTINGS", "DONE"], channel);
}
send(string command)
{
    if (listener) llListenRemove(listener);
    listener = 0;
    string body = llList2Json(JSON_OBJECT, ["request_id", (string)llGenerateKey(), "terminal", TERMINAL,
        "actor", (string)operator, "command", command]);
    request = llHTTPRequest(BASE_URL + "/v1/admin/command",
        [HTTP_METHOD, "POST", HTTP_MIMETYPE, "application/json", HTTP_CUSTOM_HEADER, "X-Plate-Token", TOKEN,
        HTTP_BODY_MAXLENGTH, 16384], body);
    expires = llGetUnixTime() + 65;
    if (request == NULL_KEY)
    {
        tell(operator, "Unable to send. Touch again shortly.");
        cleanup();
    }
}
default
{
    state_entry() { cleanup(); }
    on_rez(integer parameter) { llResetScript(); }
    changed(integer change) { if (change & CHANGED_OWNER) llResetScript(); }
    touch_start(integer count)
    {
        key avatar = llDetectedKey(0);
        if (!allowed(avatar))
        {
            tell(avatar, "Instructor access only.");
            return;
        }
        if (operator != NULL_KEY)
        {
            tell(avatar, "An admin session is active. Please wait for completion or timeout.");
            return;
        }
        operator = avatar;
        channel = -100000 - (integer)llFrand(1000000000.0);
        listener = llListen(channel, "", operator, "");
        llSetTimerEvent(5.0);
        menu();
    }
    listen(integer received, string name, key avatar, string message)
    {
        if (avatar != operator || received != channel || !allowed(avatar)) return;
        if (entering)
        {
            if (message == "BACK") menu();
            else send(message);
            return;
        }
        if (message == "DONE") { cleanup(); return; }
        string help = "";
        if (message == "COURSE")
            help = "course\ncohort|ID\nweek|1\nopen\nclose";
        else if (message == "STUDENTS")
            help = "individual|cohort|station|UUID|legacy|display|NORMAL\ncouple|cohort|station|UUID1|legacy1|display1|UUID2|legacy2|display2|NORMAL\nstudent|cohort|UUID\nstatus|cohort|UUID|Withdrawn|NORMAL";
        else if (message == "ATTENDANCE")
            help = "roster|cohort|week|page\nmark|cohort|UUID|week|Present\nUse Absent to mark absent; Unmarked to undo.\nhistory|cohort|UUID|page";
        else if (message == "STATIONS")
            help = "stations|cohort|station\nstation|cohort|UUID|station|NORMAL\nUse OVERRIDE instead of NORMAL only to deliberately share unrelated reservations.";
        else if (message == "COHORTS")
            help = "cohorts|page\ncreate|ID|Cohort Name\ncohort|ID\nPage numbers start at 0.";
        else if (message == "SETTINGS")
            help = "title|cohort|week|New title\nAdmin UUIDs and tokens are configured securely on the server. Graduation requirements remain unset.";
        if (help != "")
        {
            entering = TRUE;
            expires = llGetUnixTime() + 180;
            llTextBox(operator, help + "\n\nEnter a command, or BACK. Maximum 250 characters.", channel);
        }
    }
    http_response(key id, integer status, list metadata, string body)
    {
        if (id != request || request == NULL_KEY) return;
        string message = "Backend error or timeout. Touch to retry. For uncertain changes, view the record before repeating.";
        if (status >= 200 && status < 500 && status != 499
            && llJsonValueType(body, []) == JSON_OBJECT
            && llJsonValueType(body, ["message"]) == JSON_STRING
            && (llJsonValueType(body, ["ok"]) == JSON_TRUE || llJsonValueType(body, ["ok"]) == JSON_FALSE))
            message = llJsonGetValue(body, ["message"]);
        tell(operator, message);
        cleanup();
    }
    timer()
    {
        if (llGetUnixTime() >= expires)
        {
            tell(operator, "Admin session expired. Touch to start again. If a request was pending, inspect the record before repeating it.");
            cleanup();
        }
    }
}
