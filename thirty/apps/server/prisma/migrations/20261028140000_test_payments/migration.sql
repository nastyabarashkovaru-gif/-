-- Тестовые оплаты не входят в выручку и метрики
ALTER TABLE "Payment" ADD COLUMN "test" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Subscription" ADD COLUMN "test" BOOLEAN NOT NULL DEFAULT false;

-- Уже прошедшие тестовые оплаты: тестовый режим CloudPayments (TestMode в уведомлении), mock и Prodamus (использовался только для проверок)
UPDATE "Payment" p SET "test" = true
WHERE p.provider IN ('mock', 'prodamus')
   OR EXISTS (
     SELECT 1 FROM "PaymentEvent" e
     WHERE lower(coalesce(e.payload->>'TestMode', '')) IN ('1', 'true')
       AND (e.payload->>'InvoiceId' = p.id OR 'cp:' || (e.payload->>'TransactionId') = p."providerOrderId")
   );
UPDATE "Subscription" s SET "test" = true
WHERE EXISTS (SELECT 1 FROM "Payment" p WHERE p."subscriptionId" = s.id AND p.kind = 'initial' AND p.test)
  AND NOT EXISTS (SELECT 1 FROM "Payment" p WHERE p."subscriptionId" = s.id AND p.status IN ('paid', 'refunded') AND NOT p.test);
