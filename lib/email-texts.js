// The words of our two emails. Edit freely: this is the only file to change for wording.
// Placeholders: {name} (first name, or "there"), {city}, {country}, {total} (estimated € total).
// Email 1 also gets the day-by-day itinerary and booking links added after the text,
// and both emails get the "why you receive this" line and the unsubscribe link at the bottom.

const EMAIL_1 = {
  subject: "Your weekend in {city} is planned 🎒",
  text: `Hi {name},

Here's the full plan for your weekend in {city}, the one you picked on Weekend Escape. It's built to fit about €{total} all in: transport, 2 nights and food.`,
  after: `Next step: look up times for your dates. Prices move fast, so booking 2 to 3 weeks ahead usually keeps you inside the budget.

Questions, or want a different city? Just reply to this email, we read every reply.

Have a great trip,
The Weekend Escape team`,
};

// Sent once, if there is no reply after FOLLOW_UP_DAYS. Subject is "Re: " + Email 1's subject.
const FOLLOW_UP = {
  text: `Hi {name},

Just checking in on your {city} weekend. If you haven't booked yet, one tip: going with a friend? A private double room often costs about the same per person as two hostel beds, and you'll sleep a lot better.

Want us to sanity-check your plan? Reply with your dates and we'll tell you if it still fits your €{total} budget.

No pressure, this is our only reminder about this trip.

The Weekend Escape team`,
};

module.exports = { EMAIL_1, FOLLOW_UP };
