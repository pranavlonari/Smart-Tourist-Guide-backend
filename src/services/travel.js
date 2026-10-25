"use strict";

const { randomBytes, randomInt } = require("node:crypto");
const pool = require("../db");
const { isValidBookingDate, serviceTableFor } = require("../validation");

const services = Object.freeze({
  hotel: {
    table: "hotels",
    capacity: "available_rooms",
    price: "price_per_night",
  },
  place: {
    table: "places",
    capacity: "available_tickets",
    price: "entry_fee",
  },
  restaurant: {
    table: "restaurants",
    capacity: "available_tables",
    price: "average_cost",
  },
});

function validId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function validCount(value, maximum = 20) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 1 && count <= maximum ? count : null;
}

function validStay(checkIn, checkOut) {
  if (!isValidBookingDate(checkIn) || !isValidBookingDate(checkOut)) return false;
  return Date.parse(`${checkOut}T00:00:00Z`) > Date.parse(`${checkIn}T00:00:00Z`);
}

function nightsBetween(checkIn, checkOut) {
  return Math.ceil((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86400000);
}

function bookingDates(serviceType, bookingDate, checkOut) {
  if (serviceType === "hotel") {
    if (!validStay(bookingDate, checkOut)) return null;
    return { bookingDate, checkOut };
  }
  if (!isValidBookingDate(bookingDate)) return null;
  return { bookingDate, checkOut: null };
}

function serviceQuery(serviceType) {
  if (!serviceTableFor(serviceType)) return null;
  const service = services[serviceType];
  const extra = serviceType === "hotel"
    ? ", address, rating, price_per_night AS unitPrice, available_rooms AS capacity, amenities"
    : serviceType === "place"
      ? ", type, timings, entry_fee AS unitPrice, available_tickets AS capacity, historical_notes AS notes"
      : ", address, rating, cuisine, operating_hours AS timings, average_cost AS unitPrice, available_tables AS capacity";
  return { ...service, extra };
}

async function getAvailability({ serviceType, serviceId, destinationId, bookingDate, checkOut, connection = pool }) {
  const service = serviceQuery(serviceType);
  const id = validId(serviceId);
  const destination = validId(destinationId);
  const dates = bookingDates(serviceType, bookingDate, checkOut);
  if (!service || !id || !destination || !dates) {
    return { valid: false, available: 0, requested: 0 };
  }

  const [items] = await connection.execute(
    `SELECT id, name${service.extra}
       FROM ${service.table} WHERE id = ? AND destination_id = ? LIMIT 1`,
    [id, destination],
  );
  if (!items.length) return { valid: false, available: 0, requested: 0 };
  const listing = items[0];

  const [occupiedRows] = serviceType === "hotel"
    ? await connection.execute(
      `SELECT COALESCE(SUM(quantity), 0) AS occupied
         FROM bookings
        WHERE service_type = ? AND service_id = ?
          AND status IN ('pending', 'confirmed')
          AND booking_date < ?
          AND COALESCE(check_out, DATE_ADD(booking_date, INTERVAL 1 DAY)) > ?`,
      [serviceType, id, dates.checkOut, dates.bookingDate],
    )
    : await connection.execute(
      `SELECT COALESCE(SUM(quantity), 0) AS occupied
         FROM bookings
        WHERE service_type = ? AND service_id = ? AND booking_date = ?
          AND status IN ('pending', 'confirmed')`,
      [serviceType, id, dates.bookingDate],
    );
  const capacity = Number(listing.capacity);
  return {
    valid: true,
    available: Math.max(0, capacity - Number(occupiedRows[0].occupied)),
    requested: 0,
    service: listing,
    dates,
    unitPrice: Number(listing.unitPrice),
  };
}

async function createBooking({ touristId, destinationId, serviceType, serviceId, bookingDate, checkOut, quantity, guestCount }) {
  const userId = validId(touristId);
  const destination = validId(destinationId);
  const service = serviceQuery(serviceType);
  const id = validId(serviceId);
  const count = validCount(quantity);
  const guests = validCount(guestCount);
  const dates = bookingDates(serviceType, bookingDate, checkOut);
  if (!userId || !destination || !service || !id || !count || !guests || !dates) {
    return { error: "Choose a valid service, guest count, quantity, and future date." };
  }
  if (serviceType !== "hotel" && dates.checkOut !== null) {
    return { error: "Only hotel stays have a checkout date." };
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [servicesForDestination] = await connection.execute(
      `SELECT id FROM ${service.table} WHERE id = ? AND destination_id = ? FOR UPDATE`,
      [id, destination],
    );
    if (!servicesForDestination.length) {
      await connection.rollback();
      return { error: "That local spot isn't available for this destination.", status: 404 };
    }

    const availability = await getAvailability({
      serviceType, serviceId: id, destinationId: destination,
      bookingDate: dates.bookingDate, checkOut: dates.checkOut, connection,
    });
    if (!availability.valid) {
      await connection.rollback();
      return { error: "We couldn't find that service.", status: 404 };
    }
    if (count > availability.available) {
      await connection.rollback();
      return {
        error: `Only ${availability.available} ${serviceType === "hotel" ? "rooms" : serviceType === "place" ? "tickets" : "tables"} remain for those dates.`,
        status: 409,
        available: availability.available,
      };
    }

    const duration = serviceType === "hotel" ? nightsBetween(dates.bookingDate, dates.checkOut) : 1;
    const unitPrice = availability.unitPrice;
    const total = Math.round(unitPrice * count * duration * 100) / 100;
    const verificationToken = randomBytes(24).toString("hex");
    const [result] = await connection.execute(
      `INSERT INTO bookings
         (tourist_id, destination_id, service_type, service_id, service_name, booking_date,
          check_out, quantity, guest_count, unit_price, total_amount, verification_token, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [userId, destination, serviceType, id, availability.service.name, dates.bookingDate,
        dates.checkOut, count, guests, unitPrice, total, verificationToken],
    );
    await connection.commit();
    return {
      booking: {
        id: result.insertId,
        destinationId: destination,
        destinationName: null,
        serviceName: availability.service.name,
        serviceType,
        bookingDate: dates.bookingDate,
        checkOut: dates.checkOut,
        quantity: count,
        guestCount: guests,
        unitPrice,
        totalAmount: total,
        status: "pending",
        verificationToken,
      },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function processPayment({ bookingId, touristId, mode, bankName, simulateFailure }) {
  const id = validId(bookingId);
  const userId = validId(touristId);
  const allowedModes = ["upi", "card", "net_banking", "cash_on_arrival"];
  const allowedBanks = ["State Bank of India", "HDFC Bank", "ICICI Bank", "Axis Bank", "Kotak Mahindra Bank", "Punjab National Bank"];
  if (!id || !userId || !allowedModes.includes(mode)) {
    return { error: "Choose a valid payment option.", status: 400 };
  }
  if (mode === "net_banking" && !allowedBanks.includes(bankName)) {
    return { error: "Choose a bank to continue with the net-banking demo.", status: 400 };
  }
  if (simulateFailure && process.env.NODE_ENV === "production") {
    return { error: "Payment failure simulation is disabled in production.", status: 400 };
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT id, tourist_id AS touristId, total_amount AS totalAmount, status, verification_token AS verificationToken
         FROM bookings WHERE id = ? FOR UPDATE`,
      [id],
    );
    const booking = rows[0];
    if (!booking || Number(booking.touristId) !== userId || booking.status !== "pending") {
      await connection.rollback();
      return { error: "We couldn't find an unpaid trip to process.", status: 404 };
    }

    const failed = simulateFailure && mode !== "cash_on_arrival";
    const paymentStatus = mode === "cash_on_arrival" ? "cash_due" : failed ? "failed" : "success";
    const transactionId = `TXN${String(randomInt(0, 100000000)).padStart(8, "0")}`;
    const [result] = await connection.execute(
      `INSERT INTO payments (booking_id, tourist_id, amount, payment_mode, transaction_id, status, bank_name)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, booking.totalAmount, mode, transactionId, paymentStatus, mode === "net_banking" ? bankName : null],
    );
    if (!failed) {
      await connection.execute(
        "UPDATE bookings SET status = 'confirmed' WHERE id = ? AND status = 'pending'",
        [id],
      );
    }
    await connection.commit();
    return {
      payment: {
        id: result.insertId,
        bookingId: id,
        transactionId,
        status: paymentStatus,
        bookingStatus: failed ? "pending" : "confirmed",
        verificationToken: booking.verificationToken,
      },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { createBooking, getAvailability, processPayment };
