INSERT INTO plans (
    name,
    api_calls_limit,
    ai_tokens_limit
)
VALUES
    ('Free', 1000, 100000),
    ('Pro', 10000, 1000000),
    ('Premium', 100000, 10000000);

INSERT INTO tenants (
    name,
    email,
    hashed_password
)
VALUES (
    'Demo Tenant',
    'demo@example.com',
    'temporary-hash'
);

INSERT INTO subscriptions (
    tenant_id,
    plan_id,
    status
)
VALUES (
    1,
    1,
    'active'
);