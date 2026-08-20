# Calendly consultation setup

## Event name

**Free Forensic Credit Consultation**

## Event description

Bring your most recent three-bureau credit report and any recent correspondence from creditors, collectors, or the credit bureaus.

During this focused 30-minute consultation, we will learn your goals, review the information you bring, identify reporting issues that may warrant a deeper forensic analysis, and explain the most appropriate next step for your file.

This is an educational consultation, not a promise of deletions, a score increase, or a particular outcome. No payment, service agreement, or client portal is created by booking this call.

## Invitee questions

Calendly already collects name and email. Keep the intake short enough that qualified prospects finish booking.

1. **What is your primary credit goal right now?** — required, one selection
   - Mortgage or home purchase
   - Auto financing
   - Business funding
   - General credit improvement
   - Other

2. **When do you hope to reach this goal?** — required, one selection
   - Within 30 days
   - 1–3 months
   - 3–6 months
   - More than 6 months or no fixed deadline

3. **Do you have a current report showing Equifax, Experian, and TransUnion?** — required, one selection
   - Yes, and I can have it ready for the consultation
   - I have partial or older reports
   - No, or I need help getting it

4. **Which items are you most concerned about?** — required, allow multiple selections
   - Late payments
   - Collections or charge-offs
   - Repossessions
   - Inquiries or personal information
   - Public records
   - Identity theft or a mixed file
   - Other

5. **Have you disputed any of these items in the past 12 months?** — required, one selection
   - No
   - Yes, directly with furnishers or creditors
   - Yes, with the credit bureaus
   - Yes, both

6. **What would make this consultation most valuable to you?** — optional, long answer

If the meeting is conducted by phone or SMS reminders are enabled, also collect a required mobile number using Calendly's phone field. Do not ask for Social Security numbers, dates of birth, report-login credentials, or full account numbers in Calendly.

## Confirmation redirect

In the Calendly event editor:

1. Open **More options**, then **Confirmation page**.
2. Choose **Redirect to an external site**.
3. Enter `https://ccc-forensic-demo.netlify.app/success` (one slash before `success`).
4. Enable **Pass event details to your redirected page**.

Calendly will append the booked event's start and end time to the redirect. The page displays those values in the visitor's current device timezone, then removes Calendly's query string from the visible URL so invitee details are not left in browser history.
