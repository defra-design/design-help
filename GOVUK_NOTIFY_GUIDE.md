# Setting up GOV.UK Notify

Follow these steps to replace the "console log" simulation with real emails.

## Design help (this project)

- **Template ID (email verification):** `06e15154-5566-467d-b5be-26d3ad032d6f` — content includes `((code))`.
- **API key:** do not commit it. Set `NOTIFY_API_KEY` in **Heroku config vars** (or local `.env`) when you have it — *to follow*.

## 1. Get your API Keys

1. Log in to [GOV.UK Notify](https://www.notifications.service.gov.uk/).
2. Create a **New Template**:
    - **Name**: `Email Verification`
    - **Subject**: `Design Help - Verify your email`
    - **Content**:

        ```
        Hi,

        Your verification code is: ((code))

        Enter this code to access the Design Help tool.
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
