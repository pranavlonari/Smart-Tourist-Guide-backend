CREATE DATABASE IF NOT EXISTS roam_tourism
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE roam_tourism;

CREATE TABLE IF NOT EXISTS tourists (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(254) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  password_hash VARCHAR(60) NOT NULL,
  role ENUM('tourist', 'administrator', 'service_provider', 'system_administrator', 'hotel_manager')
    NOT NULL DEFAULT 'tourist',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tourists_email (email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS destinations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(150) NOT NULL,
  location VARCHAR(150) NOT NULL,
  state VARCHAR(100) NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  category VARCHAR(40) NOT NULL,
  tags VARCHAR(500) NOT NULL DEFAULT '',
  best_season VARCHAR(150) NOT NULL DEFAULT '',
  climate VARCHAR(250) NOT NULL DEFAULT '',
  highlights TEXT NOT NULL,
  heritage_notes TEXT NOT NULL,
  entry_fee DECIMAL(10, 2) NOT NULL DEFAULT 0,
  image_url VARCHAR(500) NOT NULL,
  rating DECIMAL(2, 1) NOT NULL DEFAULT 0,
  featured TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_destinations_category (category),
  KEY idx_destinations_state (state),
  KEY idx_destinations_featured (featured, name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS hotels (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  destination_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(150) NOT NULL,
  address VARCHAR(255) NOT NULL,
  rating DECIMAL(2, 1) NOT NULL DEFAULT 0,
  price_per_night DECIMAL(10, 2) NOT NULL DEFAULT 0,
  available_rooms INT UNSIGNED NOT NULL DEFAULT 0,
  amenities TEXT NOT NULL,
  provider_id BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY idx_hotels_destination (destination_id),
  CONSTRAINT fk_hotels_destination FOREIGN KEY (destination_id)
    REFERENCES destinations (id) ON DELETE CASCADE,
  CONSTRAINT fk_hotels_provider FOREIGN KEY (provider_id)
    REFERENCES tourists (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS places (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  destination_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(150) NOT NULL,
  type VARCHAR(80) NOT NULL,
  timings VARCHAR(120) NOT NULL,
  entry_fee DECIMAL(10, 2) NOT NULL DEFAULT 0,
  historical_notes TEXT NOT NULL,
  available_tickets INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_places_destination (destination_id),
  CONSTRAINT fk_places_destination FOREIGN KEY (destination_id)
    REFERENCES destinations (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS restaurants (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  destination_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(150) NOT NULL,
  address VARCHAR(255) NOT NULL,
  rating DECIMAL(2, 1) NOT NULL DEFAULT 0,
  cuisine VARCHAR(180) NOT NULL DEFAULT '',
  average_cost DECIMAL(10, 2) NOT NULL DEFAULT 0,
  operating_hours VARCHAR(120) NOT NULL DEFAULT '',
  available_tables INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_restaurants_destination (destination_id),
  CONSTRAINT fk_restaurants_destination FOREIGN KEY (destination_id)
    REFERENCES destinations (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS bookings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tourist_id BIGINT UNSIGNED NOT NULL,
  destination_id BIGINT UNSIGNED NOT NULL,
  service_type ENUM('hotel', 'place', 'restaurant') NOT NULL,
  service_id BIGINT UNSIGNED NOT NULL,
  service_name VARCHAR(150) NOT NULL,
  booking_date DATE NOT NULL,
  check_out DATE NULL,
  quantity INT UNSIGNED NOT NULL DEFAULT 1,
  guest_count INT UNSIGNED NOT NULL DEFAULT 1,
  unit_price DECIMAL(10, 2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  verification_token CHAR(48) NOT NULL,
  status ENUM('pending', 'confirmed', 'cancelled', 'completed') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bookings_verification (verification_token),
  KEY idx_bookings_tourist_date (tourist_id, booking_date),
  CONSTRAINT fk_bookings_tourist FOREIGN KEY (tourist_id)
    REFERENCES tourists (id) ON DELETE CASCADE,
  CONSTRAINT fk_bookings_destination FOREIGN KEY (destination_id)
    REFERENCES destinations (id) ON DELETE RESTRICT,
  KEY idx_bookings_service_dates (service_type, service_id, booking_date, check_out, status)
) ENGINE=InnoDB;

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

CREATE TABLE IF NOT EXISTS reviews (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tourist_id BIGINT UNSIGNED NOT NULL,
  destination_id BIGINT UNSIGNED NOT NULL,
  rating TINYINT UNSIGNED NOT NULL,
  comment VARCHAR(1000) NOT NULL,
  verified TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reviews_tourist_destination (tourist_id, destination_id),
  KEY idx_reviews_destination_created (destination_id, created_at),
  CONSTRAINT chk_reviews_rating CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT fk_reviews_tourist FOREIGN KEY (tourist_id)
    REFERENCES tourists (id) ON DELETE CASCADE,
  CONSTRAINT fk_reviews_destination FOREIGN KEY (destination_id)
    REFERENCES destinations (id) ON DELETE CASCADE
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

CREATE TABLE IF NOT EXISTS contact_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(254) NOT NULL,
  subject VARCHAR(150) NOT NULL,
  message TEXT NOT NULL,
  status ENUM('new', 'reviewed') NOT NULL DEFAULT 'new',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_contact_messages_status_created (status, created_at)
) ENGINE=InnoDB;
