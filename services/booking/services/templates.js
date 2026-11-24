'use strict';

const page = (title, content) => `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#fff5f5;padding:24px">
<div style="max-width:560px;margin:auto;background:white;border-radius:14px;padding:24px;border:1px solid #ffd9d9">
<h2 style="color:#b3121c">${title}</h2>${content}
<p style="color:#666;font-size:12px">Blood Donation Drive Organizer - class project.</p></div></body></html>`;

function confirmation(booking) {
  return {
    subject: `Booking confirmed: ${booking.driveTitle}`,
    html: page('Your seat is confirmed', `<p>Hi ${booking.donorName},</p>
      <p>You are booked for <strong>${booking.driveTitle}</strong> on <strong>${booking.driveDate}</strong>,
      ${booking.startTime}-${booking.endTime} at ${booking.venue}.</p>
      <p>Booking reference: <code>${booking.id}</code></p>
      <p>Please bring a photo ID and eat before donating.</p>`)
  };
}

function reminder(booking) {
  return {
    subject: `Reminder: donation tomorrow - ${booking.driveTitle}`,
    html: page('Donation tomorrow', `<p>Hi ${booking.donorName},</p>
      <p>A reminder for <strong>${booking.driveTitle}</strong> tomorrow (${booking.driveDate}),
      ${booking.startTime}-${booking.endTime} at ${booking.venue}.</p>`)
  };
}

function cancellation(booking) {
  return {
    subject: `Booking cancelled: ${booking.driveTitle}`,
    html: page('Your booking was cancelled', `<p>Hi ${booking.donorName},</p>
      <p>Your booking for ${booking.driveTitle} on ${booking.driveDate} was cancelled and the seat was released.</p>`)
  };
}

module.exports = { confirmation, reminder, cancellation };
