USE roam_tourism;

ALTER TABLE tourists
  ADD COLUMN role ENUM('tourist', 'administrator', 'service_provider', 'system_administrator', 'hotel_manager')
    NOT NULL DEFAULT 'tourist';

ALTER TABLE destinations
  ADD COLUMN state VARCHAR(100) NOT NULL DEFAULT '' AFTER location,
  ADD COLUMN tags VARCHAR(500) NOT NULL DEFAULT '',
  ADD COLUMN best_season VARCHAR(150) NOT NULL DEFAULT '',
  ADD COLUMN climate VARCHAR(250) NOT NULL DEFAULT '',
  ADD COLUMN highlights TEXT NULL,
  ADD COLUMN heritage_notes TEXT NULL;

UPDATE destinations
   SET state = SUBSTRING_INDEX(location, ',', 1),
       highlights = COALESCE(highlights, ''),
       heritage_notes = COALESCE(heritage_notes, '');
ALTER TABLE destinations
  MODIFY highlights TEXT NOT NULL,
  MODIFY heritage_notes TEXT NOT NULL;

ALTER TABLE hotels
  ADD COLUMN price_per_night DECIMAL(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN available_rooms INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN amenities TEXT NULL,
  ADD COLUMN provider_id BIGINT UNSIGNED NULL,
  ADD KEY idx_hotels_provider (provider_id),
  ADD CONSTRAINT fk_hotels_provider FOREIGN KEY (provider_id)
    REFERENCES tourists (id) ON DELETE SET NULL;
UPDATE hotels SET amenities = COALESCE(amenities, '');
ALTER TABLE hotels MODIFY amenities TEXT NOT NULL;

ALTER TABLE places
  ADD COLUMN entry_fee DECIMAL(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN historical_notes TEXT NULL,
  ADD COLUMN available_tickets INT UNSIGNED NOT NULL DEFAULT 0;
UPDATE places SET historical_notes = COALESCE(historical_notes, '');
ALTER TABLE places MODIFY historical_notes TEXT NOT NULL;

ALTER TABLE restaurants
  ADD COLUMN cuisine VARCHAR(180) NOT NULL DEFAULT '',
  ADD COLUMN average_cost DECIMAL(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN operating_hours VARCHAR(120) NOT NULL DEFAULT '',
  ADD COLUMN available_tables INT UNSIGNED NOT NULL DEFAULT 0;

ALTER TABLE bookings
  MODIFY status ENUM('pending', 'confirmed', 'cancelled', 'completed') NOT NULL DEFAULT 'pending',
  ADD COLUMN check_out DATE NULL,
  ADD COLUMN quantity INT UNSIGNED NOT NULL DEFAULT 1,
  ADD COLUMN guest_count INT UNSIGNED NOT NULL DEFAULT 1,
  ADD COLUMN unit_price DECIMAL(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN total_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN verification_token CHAR(48) NULL,
  ADD KEY idx_bookings_service_dates (service_type, service_id, booking_date, check_out, status);
UPDATE bookings
   SET verification_token = LEFT(CONCAT(REPLACE(UUID(), '-', ''), REPLACE(UUID(), '-', '')), 48)
 WHERE verification_token IS NULL;
ALTER TABLE bookings
  MODIFY verification_token CHAR(48) NOT NULL,
  ADD UNIQUE KEY uq_bookings_verification (verification_token);

ALTER TABLE reviews
  ADD COLUMN verified TINYINT(1) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS payments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_id BIGINT UNSIGNED NOT NULL,
  tourist_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  payment_mode ENUM('upi', 'card', 'net_banking', 'cash_on_arrival') NOT NULL,
  transaction_id VARCHAR(32) NOT NULL,
  status ENUM('pending', 'success', 'failed', 'refunded', 'cash_due') NOT NULL,
  bank_name VARCHAR(80) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  refunded_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payments_transaction (transaction_id),
  KEY idx_payments_booking (booking_id, created_at),
  CONSTRAINT fk_payments_booking FOREIGN KEY (booking_id)
    REFERENCES bookings (id) ON DELETE RESTRICT,
  CONSTRAINT fk_payments_tourist FOREIGN KEY (tourist_id)
    REFERENCES tourists (id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_id BIGINT UNSIGNED NOT NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  details JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_actor_created (actor_id, created_at),
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id)
    REFERENCES tourists (id) ON DELETE RESTRICT
) ENGINE=InnoDB;
