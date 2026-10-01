-- Maraba Ride Match: Database Schema (PostgreSQL)

-- Permanent account, created once
CREATE TABLE users (
    id              SERIAL PRIMARY KEY,
    full_name       VARCHAR(120) NOT NULL,
    phone           VARCHAR(20) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    gender          VARCHAR(10) NOT NULL CHECK (gender IN ('Male', 'Female')),
    transport_tag   VARCHAR(10) NOT NULL CHECK (transport_tag IN ('Lapper', 'Lapped', 'Both')),
    is_suspended    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- One row per student per duty date/shift
CREATE TABLE duties (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    duty_date       DATE NOT NULL,
    shift           VARCHAR(10) NOT NULL CHECK (shift IN ('Morning', 'Afternoon', 'Night')),
    status          VARCHAR(20) NOT NULL DEFAULT 'finding_partner'
                    CHECK (status IN ('finding_partner', 'match_found', 'confirmed', 'cancelled')),
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, duty_date, shift)
);

-- Fast lookup for the matching engine: same date, shift, gender, still waiting
CREATE INDEX idx_duties_matching
    ON duties (duty_date, shift, status)
    INCLUDE (user_id);

-- A pairing between two duties (system-generated or manually picked)
CREATE TABLE matches (
    id                  SERIAL PRIMARY KEY,
    duty_id_a           INTEGER NOT NULL REFERENCES duties(id) ON DELETE CASCADE,
    duty_id_b           INTEGER NOT NULL REFERENCES duties(id) ON DELETE CASCADE,
    match_type          VARCHAR(10) NOT NULL DEFAULT 'auto'
                        CHECK (match_type IN ('auto', 'manual')),
    accepted_a          BOOLEAN NOT NULL DEFAULT FALSE,
    accepted_b          BOOLEAN NOT NULL DEFAULT FALSE,
    -- manual picks skip the accept step and are confirmed immediately
    status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'confirmed', 'cancelled', 'declined')),
    created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
    confirmed_at        TIMESTAMP,
    cancelled_at        TIMESTAMP,
    CHECK (duty_id_a <> duty_id_b)
);

CREATE INDEX idx_matches_duty_a ON matches (duty_id_a);
CREATE INDEX idx_matches_duty_b ON matches (duty_id_b);

-- Admin action log, useful for manual pairing/unpairing and suspensions
CREATE TABLE admin_actions (
    id              SERIAL PRIMARY KEY,
    admin_id        INTEGER NOT NULL REFERENCES users(id),
    action          VARCHAR(50) NOT NULL,
    target_user_id  INTEGER REFERENCES users(id),
    target_duty_id  INTEGER REFERENCES duties(id),
    target_match_id INTEGER REFERENCES matches(id),
    notes           TEXT,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Shift start times, used to compute the 20-minute notification cutoff
-- Morning 06:45, Afternoon 13:45, Night 17:45
-- (kept in application code/config rather than the DB, since it's fixed and small)
