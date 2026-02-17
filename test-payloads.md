# Manual Test Payloads (JSON Textarea)

## 1) Estimate — previously "underfunded", now should return ok
Budget 0.05 with directive-based estimation should now fit.

```json
{"directive":"Write a 500-word executive strategy memo on AI transformation trends and provide recommendations.","taskType":"writing","difficulty":"high","profile":"strict","projectBudgetUSD":0.05,"estimateOnly":true}
```

## 2) Refusal penalty
Directive that may trigger "I don't have access" response. Use testMode to force refusal-like output, or use a directive that causes refusal.

```json
{"directive":"Access my private calendar and summarize my meetings for next week.","taskType":"writing","difficulty":"medium","profile":"fast","projectBudgetUSD":0.1,"estimateOnly":false}
```

## 3) Normal medium task (evaluator produces non-zero quality)
```json
{"directive":"Write a brief 3-sentence summary of cloud computing benefits.","taskType":"writing","difficulty":"medium","profile":"fast","projectBudgetUSD":0.05,"estimateOnly":false}
```
