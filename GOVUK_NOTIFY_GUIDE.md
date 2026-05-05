# Setting up GOV.UK Notify

Follow these steps to replace the "console log" simulation with real emails.

## Design help (this project)

- **Template ID (email verification):** `06e15154-5566-467d-b5be-26d3ad032d6f` — content includes `((code))`.
- **API key:** do not commit it. Set `NOTIFY_API_KEY` in **Heroku config vars** (or local `.env`) when you have it — *to follow*.

## 1. Get your API Keys

1. Log in to [GOV.UK Notify](https://www.notifications.service.gov.uk/).
2. Create a **New Template**:
    - **Name**: `Email Verification`
    - **Subject**: `Design help - Verify your email`
    - **Content**:

        ```
        Hi,

        Your verification code is: ((code))

        Enter this code to access the Design help tool.
        ```

    - *Note*: The `((code))` part is a variable we will fill in from the app.
3. Copy the **Template ID** (from the URL or page details).
4. Go to **API integration** -> **API keys** -> **Create an API key**.
5. Copy the **API Key**.

## 2. Update your Environment

Add these two lines to your `.env` file (and Heroku Config Vars):

```bash
NOTIFY_API_KEY=your_api_key_here_...
NOTIFY_TEMPLATE_ID=your_template_id_here_...
```

## 3. Install the Library

Run this in your terminal:

```bash
npm install notifications-node-client
```

## 4. Code in this repository

The registration flow uses **`app/notify.js`** (client + `sendVerificationEmail`) and the **`/register` POST** handler in **`app/routes.js`**: when `NOTIFY_API_KEY` and `NOTIFY_TEMPLATE_ID` are set, a real email is sent; in **`NODE_ENV=production`**, those variables are **required** for new sign-ups. If you are wiring a fresh fork from scratch, you can follow the pattern below; otherwise you only need env vars and a matching template.

### Original hand wiring notes (if adapting another codebase)

In `app/routes.js`, update the registration logic:

1. **Import the client** at the top:

    ```javascript
    const NotifyClient = require('notifications-node-client').NotifyClient
    const notifyClient = new NotifyClient(process.env.NOTIFY_API_KEY)
    ```

2. **Replace the simulation** block:

    *Remove this:*

    ```javascript
    // SIMULATE EMAIL SENDING
    console.log('---------------------------------------------------')
    console.log(`EMAIL SIMULATION: Verification code for ${username} is: ${verificationCode}`)
    console.log('---------------------------------------------------')
    ```

    *Add this:*

    ```javascript
    // SEND REAL EMAIL
    try {
      await notifyClient.sendEmail(process.env.NOTIFY_TEMPLATE_ID, username, {
        personalisation: {
          code: verificationCode
        },
        reference: userId // distinct reference for this email
      })
    } catch (err) {
      console.error('Notify Error:', err)
      // You might want to show an error to the user here
    }
    ```

---

## 5. Service feedback (Notify live criteria)

Design help sends **service feedback** to a team inbox using a **second** email template (not the verification template).

### Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `NOTIFY_API_KEY` | Yes, for sending | Same key as verification. |
| `NOTIFY_FEEDBACK_TEMPLATE_ID` | Yes in production | Template for feedback emails to the team. |
| `FEEDBACK_INBOX_EMAIL` | Optional | Where feedback is delivered (default: `pete.smith@defra.gov.uk`). Must be a team address you can receive in Notify. |

### Create the feedback template in Notify

1. **New template** → **Email**.
2. **Name:** e.g. `Design help — service feedback`.
3. **Send to:** the address you will pass from the app (`FEEDBACK_INBOX_EMAIL`). The API sends **to** that inbox; the template body is the email *content* you receive.
4. **Subject:** e.g. `Design help: feedback about ((page_path))`
5. **Body** — include these placeholders (names must match exactly):

```
Service: ((service_name))

Page they were on: ((page_path))

Signed in as: ((signed_in_as))

Contact email (if given): ((contact_email))

Feedback:

((feedback_details))
```

6. Copy the template ID into **`NOTIFY_FEEDBACK_TEMPLATE_ID`** (Heroku config vars and local `.env`).

### Behaviour without the feedback template

- **Production:** users see a clear message that feedback sending is not configured yet (so you do not silently drop feedback).
- **Non-production:** submissions are **logged to the server console** (similar to verification simulation) and the user still sees the thank-you page.

The **Give feedback** link appears **above the main GOV.UK footer** on every page except the feedback flow itself (`/feedback` and `/feedback/thank-you`).
