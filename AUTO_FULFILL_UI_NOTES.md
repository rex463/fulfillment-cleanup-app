# Auto Fulfill UI v2

This version adds an embedded **Auto Fulfill** page at `/app/auto-fulfill`.

## What the page controls
- Master Auto Fulfill ON/OFF toggle
- Navidium target SKUs ON/OFF
- Drop Ship fee target SKUs ON/OFF
- Last processed order / last run / last status
- Recent automation activity log

## Safety
- Defaults to OFF unless an existing `AUTO_FULFILL_ENABLED=true` environment fallback is present.
- Once settings are saved in the UI, database settings are used.
- Regular merchandise is not fulfilled by this automation.
- Customer notifications remain disabled in the existing fulfillment mutation.

## Deployment
The existing Render start command runs `npm run setup`, which includes `prisma migrate deploy`; this applies the new settings/log tables on deploy.

The Shopify `orders/create` webhook from v1 remains required and is already declared in the production TOML.
