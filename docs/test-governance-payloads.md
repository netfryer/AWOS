# Governance Test Payloads

Paste one of the following into the JSON textarea.

## A) Fast governance, budget 0.01

```json
{"directive":"Launch a customer loyalty program to reduce churn by 15% within 12 months.","governanceBudgetUSD":0.01,"speedPreference":"fast","governanceOnly":true}
```

## B) Thorough governance, budget 0.05

```json
{"directive":"Launch a customer loyalty program to reduce churn by 15% within 12 months. Include tiered rewards, points system, and partner integrations.","domain":"retail","businessContext":"B2C e-commerce, 2M monthly active users","successMetrics":["churn reduction","NPS","repeat purchase rate"],"timeHorizon":"12 months","governanceBudgetUSD":0.05,"speedPreference":"thorough","governanceOnly":true}
```

## C) Minimal directive (expect needs_clarification)

```json
{"directive":"Do the thing.","governanceBudgetUSD":0.02,"governanceOnly":true}
```
