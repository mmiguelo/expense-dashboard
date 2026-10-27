#!/usr/bin/env bash
# Manual security check against the LOCAL Supabase (npm run db:start), using plain HTTP
# requests with real user tokens, the way any client could. Prints each check and its
# result. Refuses to run against anything but localhost.
#
#   ./scripts/security-check.sh
set -euo pipefail
cd "$(dirname "$0")/.."

eval "$(npx supabase status -o env 2>/dev/null | grep -E '^(API_URL|PUBLISHABLE_KEY|DB_URL|MAILPIT_URL)=')"
case "$API_URL" in http://127.0.0.1:*|http://localhost:*) ;; *) echo "Refusing: $API_URL is not local"; exit 1 ;; esac
K=$PUBLISHABLE_KEY U=$API_URL
PASS=correct-horse-battery
fails=0

psql_() { docker exec -i supabase_db_expenseDashboard psql -U postgres -At -c "$1"; }
json() { python3 -c "import sys,json; d=json.load(sys.stdin); print($1)"; }
api() { # api TOKEN METHOD PATH [BODY] -> prints "HTTP_CODE BODY"
  local t=$1 m=$2 p=$3 b=${4:-}
  curl -s -X "$m" "$U$p" -H "apikey: $K" ${t:+-H "Authorization: Bearer $t"} -H 'Content-Type: application/json' \
    -H 'Prefer: return=representation' ${b:+-d "$b"} -w ' %{http_code}' | awk '{code=$NF; $NF=""; print code" "$0}'
}
upsert() { # upsert TOKEN PATH BODY: insert, or update the row with the same id
  curl -s -X POST "$U$2" -H "apikey: $K" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' \
    -H 'Prefer: resolution=merge-duplicates,return=representation' -d "$3" -w ' %{http_code}' | awk '{code=$NF; $NF=""; print code" "$0}'
}
check() { # check "description" "expected substring" "actual"
  if [[ "$3" == *"$2"* ]]; then echo "  PASS  $1"; else echo "  FAIL  $1"; echo "        expected: $2"; echo "        got:      ${3:0:200}"; fails=$((fails+1)); fi
}
signup() { curl -s "$U/auth/v1/signup" -H "apikey: $K" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PASS\"}" >/dev/null; }
confirm() { # follow the link in the confirmation email (from Mailpit)
  local id link
  for _ in $(seq 50); do id=$(curl -s "$MAILPIT_URL/api/v1/search?query=to:%22$1%22" | json "d['messages'][0]['ID'] if d['messages'] else ''"); [ -n "$id" ] && break; sleep 0.2; done
  link=$(curl -s "$MAILPIT_URL/api/v1/message/$id" | json "__import__('re').search(r'https?://[^\s\"<>]+/auth/v1/verify\?[^\s\"<>]+', d['Text']).group(0).replace('&amp;','&')")
  curl -s -o /dev/null "$link"
}
login() { curl -s "$U/auth/v1/token?grant_type=password" -H "apikey: $K" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PASS\"}"; }
token() { login "$1" | json "d['access_token']"; }
user() { local e="check-$1-$RANDOM$RANDOM@example.test"; signup "$e"; confirm "$e"; echo "$e"; }

echo "Creating accounts (real sign-up and email confirmation)…"
A_EMAIL=$(user alice); B_EMAIL=$(user bob); ADM_EMAIL=$(user admin)
A=$(token "$A_EMAIL"); B=$(token "$B_EMAIL")
ADM_ID=$(login "$ADM_EMAIL" | json "d['user']['id']"); A_ID=$(login "$A_EMAIL" | json "d['user']['id']")
psql_ "update public.profiles set role = 'admin' where id = '$ADM_ID'" >/dev/null   # as in the README
ADM=$(token "$ADM_EMAIL")
TX=$(api "$A" POST /rest/v1/transactions '{"date":"2026-10-27","amount":42,"type":"expense","category":"Groceries","description":"Alice private"}' | cut -d' ' -f2- | json "d[0]['id']")

echo; echo "1. A member cannot read or modify another member's data"
check "Bob lists transactions: none of Alice's" "200 []" "$(api "$B" GET '/rest/v1/transactions?select=description')"
check "Bob asks for Alice's transaction by id: nothing" "200 []" "$(api "$B" GET "/rest/v1/transactions?id=eq.$TX")"
check "Bob updates it: 0 rows" "200 []" "$(api "$B" PATCH "/rest/v1/transactions?id=eq.$TX" '{"amount":1}')"
check "Bob deletes it: 0 rows" "200 []" "$(api "$B" DELETE "/rest/v1/transactions?id=eq.$TX")"
check "Bob overwrites it by id (upsert): refused (RLS)" "row-level security" "$(upsert "$B" /rest/v1/transactions "{\"id\":\"$TX\",\"date\":\"2026-01-01\",\"amount\":1,\"type\":\"expense\",\"category\":\"X\"}")"
check "Bob inserts a row owned by Alice: refused" "row-level security" "$(api "$B" POST /rest/v1/transactions "{\"user_id\":\"$A_ID\",\"date\":\"2026-01-01\",\"amount\":1,\"type\":\"expense\",\"category\":\"X\"}")"
check "Bob reads Alice's categories: none" "200 []" "$(api "$B" GET "/rest/v1/categories?user_id=eq.$A_ID")"
check "Alice's transaction is unchanged" '"amount":42' "$(api "$A" GET "/rest/v1/transactions?id=eq.$TX")"

echo; echo "2. A member cannot change roles or read other profiles' admin fields"
check "Bob sees only his own profile" "200 [{\"email\":\"$B_EMAIL\"" "$(api "$B" GET '/rest/v1/profiles?select=email,role,active')"
check "Bob reads Alice's profile: nothing" "200 []" "$(api "$B" GET "/rest/v1/profiles?id=eq.$A_ID&select=role,active")"
check "Bob makes himself admin: refused" "only admins can change roles" "$(api "$B" PATCH '/rest/v1/profiles?role=eq.member' '{"role":"admin"}')"
check "Bob deactivates Alice: 0 rows" "200 []" "$(api "$B" PATCH "/rest/v1/profiles?id=eq.$A_ID" '{"active":false}')"
check "Bob changes a default category: 0 rows" "200 []" "$(api "$B" PATCH '/rest/v1/default_categories?name=eq.Groceries' '{"color":"#000000"}')"

echo; echo "3. An admin cannot read a member's transactions"
check "Admin lists Alice's transactions: nothing" "200 []" "$(api "$ADM" GET "/rest/v1/transactions?user_id=eq.$A_ID")"
check "Admin asks for the transaction by id: nothing" "200 []" "$(api "$ADM" GET "/rest/v1/transactions?id=eq.$TX")"
check "Admin reads Alice's budgets / rules: nothing" "200 []" "$(api "$ADM" GET "/rest/v1/keyword_rules?user_id=eq.$A_ID")"
check "Admin does see Alice's account info" "\"email\":\"$A_EMAIL\"" "$(api "$ADM" GET "/rest/v1/profiles?id=eq.$A_ID&select=email,role,active")"

echo; echo "4. A deactivated user is locked out of every table, even with a valid session"
check "Admin deactivates Alice" '"active":false' "$(api "$ADM" PATCH "/rest/v1/profiles?id=eq.$A_ID" '{"active":false}')"
for t in transactions categories keyword_rules budgets recurring_expenses recurring_occurrences category_corrections default_categories default_keyword_rules; do
  check "Alice's old token reads $t: nothing" "200 []" "$(api "$A" GET "/rest/v1/$t?select=*")"
done
check "Alice's old token inserts: refused" "row-level security" "$(api "$A" POST /rest/v1/transactions '{"date":"2026-01-01","amount":1,"type":"expense","category":"X"}')"
check "Alice's old token imports: refused" "not active" "$(api "$A" POST /rest/v1/rpc/import_snapshot '{"payload":{}}')"
check "Alice can see that she is deactivated" '"active":false' "$(api "$A" GET '/rest/v1/profiles?select=active')"
check "Her data is still there" "1" "$(psql_ "select count(*) from public.transactions where user_id = '$A_ID'")"
api "$ADM" PATCH "/rest/v1/profiles?id=eq.$A_ID" '{"active":true}' >/dev/null
check "Reactivated: her transaction is back" '"Alice private"' "$(api "$A" GET '/rest/v1/transactions?select=description')"

echo; echo "5. An unconfirmed user cannot access data"
C_EMAIL="check-carol-$RANDOM$RANDOM@example.test"
SIGNUP=$(curl -s "$U/auth/v1/signup" -H "apikey: $K" -H 'Content-Type: application/json' -d "{\"email\":\"$C_EMAIL\",\"password\":\"$PASS\"}")
check "Sign-up returns no session (no access token)" "no token" "$(grep -q access_token <<<"$SIGNUP" && echo "got a token" || echo "no token")"
check "Sign-in refused: email not confirmed" "email_not_confirmed" "$(login "$C_EMAIL")"
check "No token: every table refused" "permission denied" "$(api "" GET '/rest/v1/transactions')"

echo; echo "6. The last active admin cannot be removed or deactivated"
OTHERS=$(psql_ "select count(*) from public.profiles where role = 'admin' and active and id <> '$ADM_ID'")
echo "        (other active admins in this local database: $OTHERS; checked in a rolled-back transaction with only this admin)"
check "Admin demotes themselves: refused" "cannot change your own role" "$(api "$ADM" PATCH "/rest/v1/profiles?id=eq.$ADM_ID" '{"role":"member"}')"
check "Admin deactivates themselves: refused" "cannot deactivate your own" "$(api "$ADM" PATCH "/rest/v1/profiles?id=eq.$ADM_ID" '{"active":false}')"
LAST=$(docker exec -i supabase_db_expenseDashboard psql -U postgres -At 2>&1 <<SQL || true
begin;
update public.profiles set role = 'member' where role = 'admin' and id <> '$ADM_ID';
update public.profiles set active = false where id = '$ADM_ID';
rollback;
SQL
)
check "SQL Editor deactivates the last admin: refused" "at least one active admin" "$LAST"
LAST=$(docker exec -i supabase_db_expenseDashboard psql -U postgres -At 2>&1 <<SQL || true
begin;
update public.profiles set role = 'member' where role = 'admin' and id <> '$ADM_ID';
delete from auth.users where id = '$ADM_ID';
rollback;
SQL
)
check "Deleting the last admin's user: refused" "at least one active admin" "$LAST"

echo
if [ "$fails" -eq 0 ]; then echo "All checks passed."; else echo "$fails check(s) FAILED."; exit 1; fi
