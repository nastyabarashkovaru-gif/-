ALTER TABLE "TributeEntitlement"
  DROP CONSTRAINT "TributeEntitlement_pkey",
  ADD CONSTRAINT "TributeEntitlement_pkey" PRIMARY KEY ("userId", "offerId");
