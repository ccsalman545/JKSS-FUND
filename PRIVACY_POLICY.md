# Privacy Policy — JKSS Fund

**Effective date:** (set this)

JKSS Fund ("the App") is a hostel fund management tool. This policy explains what data
we collect and how it is used.

## Data we collect
- **Account data:** email address and display name (from Google Sign-In or email/password).
- **Fund data:** job amounts, per-student balances, withdrawals, and committee fund totals
  you or your administrator enter.
- We do **not** collect precise location, contacts, or device identifiers beyond what
  Firebase requires to operate authentication.

## How we use data
- To attribute fund earnings and withdrawals to the correct student account.
- To compute and display the 10% committee / 90% student distribution.
- To keep balances and dashboards in sync in real time via Cloud Firestore.

## Storage & security
- Data is stored in **Google Firebase (Cloud Firestore)** and secured by Firebase
  Security Rules so students can only see their own balance and transactions, and only
  administrators can manage jobs and student records.
- Authentication is handled by Firebase Authentication (Google / Email-Password).

## Data retention & deletion
- Fund records persist until an administrator deletes a job or student, or the project is
  removed. To delete your account and associated data, contact the system administrator
  or email (provide contact). We will delete the relevant Firestore `users`, `transactions`
  and balance records within 30 days of a verified request.

## Children
The App is intended for use by hostel residents and administrators. If you are under the
age of digital consent in your region, use it only with your administrator's permission.

## Contact
Questions or deletion requests: (provide an email / contact).

## Changes
We may update this policy; the "Effective date" reflects the latest version.
