#!/bin/bash
#
# Smoke tests for a deployed Alzhal instance.
# Set BASE_URL to your deployed worker URL before running.

BASE_URL="${BASE_URL:-https://your-worker.workers.dev}"

if [[ "$BASE_URL" == *"your-worker.workers.dev"* ]]; then
  echo "Set BASE_URL=https://your-deployed-worker.workers.dev before running."
  exit 1
fi

echo "========================================="
echo "ALZHAL DEPLOYMENT SMOKE TEST"
echo "Target: $BASE_URL"
echo "========================================="

# Test 1: Home Page
echo ""
echo "TEST 1: Home Page"
echo "-----------------"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL")
echo "Status Code: $STATUS"
if [ "$STATUS" == "200" ]; then
  echo "PASS"
else
  echo "FAIL"
fi

# Test 2: Stats API
echo ""
echo "TEST 2: Stats API"
echo "-----------------"
STATS=$(curl -s "$BASE_URL/api/stats")
echo "$STATS" | python3 -m json.tool | head -10
if echo "$STATS" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if 'productsChecked' in d else 1)"; then
  echo "PASS"
else
  echo "FAIL"
fi

# Test 3: Text Analysis API
echo ""
echo "TEST 3: Text Analysis API"
echo "-------------------------"
ANALYSIS=$(curl -s -X POST "$BASE_URL/api/analyze/text" \
  -H "Content-Type: application/json" \
  -d '{"ingredients":["water","sugar","salt"]}')
echo "$ANALYSIS" | python3 -m json.tool | head -20
if echo "$ANALYSIS" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d.get('success') else 1)" 2>/dev/null; then
  echo "PASS"
else
  echo "FAIL"
fi

# Test 4: Compare API
echo ""
echo "TEST 4: Compare API"
echo "-------------------"
COMPARE=$(curl -s -X POST "$BASE_URL/api/compare" \
  -H "Content-Type: application/json" \
  -d '{"products":[{"name":"Product A","ingredients":["water","sugar"]},{"name":"Product B","ingredients":["water","aspartame"]}]}')
echo "$COMPARE" | python3 -m json.tool | head -15
if echo "$COMPARE" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d.get('success') else 1)" 2>/dev/null; then
  echo "PASS"
else
  echo "FAIL"
fi

# Test 5: Feedback API
echo ""
echo "TEST 5: Feedback API"
echo "--------------------"
FEEDBACK=$(curl -s -X POST "$BASE_URL/api/feedback" \
  -H "Content-Type: application/json" \
  -d '{"scanId":"test-'$(date +%s)'","rating":5,"comment":"Automated test","type":"general"}')
echo "$FEEDBACK"
if echo "$FEEDBACK" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d.get('success') else 1)" 2>/dev/null; then
  echo "PASS"
else
  echo "FAIL"
fi

echo ""
echo "========================================="
echo "TESTS COMPLETE"
echo "========================================="
