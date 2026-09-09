#!/usr/bin/env bash
# End-to-end API smoke test for the Multi-Madrasa Platform (dev server on :3000)
set -u
B=http://localhost:3000/api
pass=0; fail=0
chk() { if [ "$2" -eq 0 ]; then echo "  PASS: $1"; pass=$((pass+1)); else echo "  FAIL: $1"; fail=$((fail+1)); fi; }

# JQ <py-expr using d>  — parse JSON on stdin as d, print expression result
JQ() { python3 -c "import sys,json; d=json.load(sys.stdin); print($1)"; }

login() { # file user pass
  rm -f "$1"
  local csrf=$(curl -s -c "$1" $B/csrf-token | JQ "d['csrfToken']")
  curl -s -b "$1" -c "$1" -H "Content-Type: application/json" -H "X-CSRF-Token: $csrf" \
    -d "{\"username\":\"$2\",\"password\":\"$3\"}" $B/auth/login > /tmp/login-resp.json
}
csrf() { curl -s -b "$1" -c "$1" $B/csrf-token | JQ "d['csrfToken']"; }

SAPASS=$(grep SUPER_ADMIN_PASSWORD /home/user/BELLO-INSTITUTE-/.env | cut -d= -f2)

echo "== 1. Health & auth =="
curl -s $B/health | JQ "d['ok']" >/dev/null; chk "health" $?
login /tmp/sa.txt "admin" "$SAPASS"
grep -q '"role":"super_admin"' /tmp/login-resp.json; chk "super admin login" $?

echo "== 2. Super admin platform =="
login /tmp/sa.txt "admin" "$SAPASS"
curl -s -b /tmp/sa.txt $B/platform/stats | JQ "d['madaris']" >/dev/null; chk "platform stats" $?
curl -s -b /tmp/sa.txt $B/platform/madaris | JQ "len(d['madaris'])" | grep -q 2; chk "2 madaris listed" $?

echo "== 3. Madrasa A admin =="
login /tmp/ma.txt "demo-quraniyya-admin" "Demo1234!"
grep -q '"role":"madrasa_admin"' /tmp/login-resp.json; chk "madrasa admin login" $?
curl -s -b /tmp/ma.txt $B/madrasa/profile | JQ "d['madrasa']['name_en']" | grep -q "Al-Quraniyya"; chk "own profile" $?
curl -s -b /tmp/ma.txt "$B/students?perPage=5" | JQ "len(d['students'])" | grep -q 4; chk "lists own students (4)" $?
curl -s -b /tmp/ma.txt "$B/classes" | JQ "len(d['classes'])" | grep -q 4; chk "lists own classes (4)" $?
curl -s -b /tmp/ma.txt $B/grading | JQ "d['caMax']" | grep -q 40; chk "grading config" $?

echo "== 4. Results compute + report card =="
CLS=$(curl -s -b /tmp/ma.txt $B/classes | JQ "d['classes'][0]['id']")
TERM=$(curl -s -b /tmp/ma.txt $B/sessions | JQ "d['sessions'][0]['terms'][0]['id']")
curl -s -b /tmp/ma.txt -X POST -H "Content-Type: application/json" $B/results/compute \
  -H "X-CSRF-Token: $(csrf /tmp/ma.txt)" \
  -d "{\"classId\":$CLS,\"termId\":$TERM}" | JQ "len(d['students'])" | grep -q 2; chk "compute returns 2 students" $?
curl -s -b /tmp/ma.txt "$B/results/summary?classId=$CLS&termId=$TERM" | JQ "len(d['students'])" | grep -q 2; chk "summary 2 students" $?
STU=$(curl -s -b /tmp/ma.txt "$B/students?perPage=1" | JQ "d['students'][0]['id']")
RC=$(curl -s -b /tmp/ma.txt "$B/results/report-card/$STU/$TERM")
echo "$RC" | grep -qE "TERM REPORT CARD|بطاقة النتائج"; chk "report card HTML renders" $?
echo "$RC" | grep -qE "Al-Quraniyya Model Madrasa|مدرسة القرونية النموذجية"; chk "report card shows madrasa name" $?
echo "$RC" | grep -q "Position"; chk "report card shows position" $?

echo "== 5. Tenant isolation (A cannot reach B) =="
login /tmp/mb.txt "demo-fatihah-admin" "Demo1234!"
MBSTU=$(curl -s -b /tmp/mb.txt "$B/students?perPage=1" | JQ "d['students'][0]['id']")
BCLS=$(curl -s -b /tmp/mb.txt $B/classes | JQ "d['classes'][0]['id']")
CODE=$(curl -s -o /dev/null -w "%{http_code}" -b /tmp/ma.txt "$B/students/$MBSTU")
[ "$CODE" = "404" ]; chk "A cannot read B's student (got $CODE, want 404)" $?
CODE=$(curl -s -o /dev/null -w "%{http_code}" -b /tmp/ma.txt -X POST -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $(csrf /tmp/ma.txt)" -d "{\"classId\":$BCLS,\"termId\":$TERM}" $B/results/compute)
[ "$CODE" = "404" ]; chk "A cannot compute B's class results (got $CODE, want 404)" $?
CODE=$(curl -s -o /dev/null -w "%{http_code}" -b /tmp/ma.txt -X PATCH -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $(csrf /tmp/ma.txt)" -d '{"status":"suspended"}' "$B/students/$MBSTU/status")
[ "$CODE" = "404" ]; chk "A cannot change B's student status (got $CODE, want 404)" $?
# A admin cannot read B's report card
CODE=$(curl -s -o /dev/null -w "%{http_code}" -b /tmp/ma.txt "$B/results/report-card/$MBSTU/$TERM")
[ "$CODE" = "404" ]; chk "A cannot read B's report card (got $CODE, want 404)" $?

echo "== 6. Parent portal (linked child only) =="
login /tmp/par.txt "demo-quraniyya-parent1" "Parent1234!"
grep -q '"role":"parent"' /tmp/login-resp.json; chk "parent login" $?
CHILD=$(curl -s -b /tmp/par.txt $B/portal/me | JQ "d['children'][0]['id']")
curl -s -b /tmp/par.txt "$B/portal/results?studentId=$CHILD" | JQ "len(d['terms'])" | grep -qE "^[12]"; chk "parent sees own child results" $?
OTHER=$(curl -s -b /tmp/ma.txt "$B/students?perPage=200" | JQ "d['students'][1]['id']")
CODE=$(curl -s -o /dev/null -w "%{http_code}" -b /tmp/par.txt "$B/portal/results?studentId=$OTHER")
[ "$CODE" = "400" -o "$CODE" = "404" ]; chk "parent blocked from unlinked child (got $CODE)" $?

echo "== 7. Student portal (own record only) =="
login /tmp/stu.txt "demo-quraniyya-stu1" "Student1234!"
grep -q '"role":"student"' /tmp/login-resp.json; chk "student login" $?
curl -s -b /tmp/stu.txt $B/portal/me | JQ "d['self']['admission_no']" | grep -q "ALQ"; chk "student sees own profile" $?
CODE=$(curl -s -o /dev/null -w "%{http_code}" -b /tmp/stu.txt "$B/students")
[ "$CODE" = "403" ]; chk "student blocked from student list (got $CODE)" $?
STTERM=$(curl -s -b /tmp/stu.txt $B/portal/results | JQ "d['terms'][0]['term_id'] if d['terms'] else 0")
if [ "$STTERM" != "0" ]; then
  RC=$(curl -s -b /tmp/stu.txt "$B/portal/report-card?termId=$STTERM")
  echo "$RC" | grep -qE "TERM REPORT CARD|بطاقة النتائج"; chk "student report card renders" $?
else
  echo "  FAIL: no student term summary"; fail=$((fail+1)); fi

echo "== 8. Security checks =="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -b /tmp/ma.txt -X POST -H "Content-Type: application/json" -d '{}' $B/announcements)
[ "$CODE" = "403" ]; chk "CSRF enforced (no token -> 403, got $CODE)" $?
login /tmp/sq.txt "admin' OR '1'='1" "x"
grep -q '"error"' /tmp/login-resp.json; chk "SQLi login rejected" $?
CODE=$(curl -s -o /dev/null -w "%{http_code}" -b /tmp/ma.txt $B/platform/madaris)
[ "$CODE" = "403" ]; chk "madrasa admin blocked from platform (got $CODE)" $?
CODE=$(curl -s -o /dev/null -w "%{http_code}" -b /tmp/sa.txt "$B/students/999999?madrasaId=1")
[ "$CODE" = "404" ]; chk "nonexistent student 404 (got $CODE)" $?

echo
echo "RESULT: $pass passed, $fail failed"
exit $fail
