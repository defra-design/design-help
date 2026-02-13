# Setting up GOV.UK Notify

Follow these steps to replace the "console log" simulation with real emails.

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

## 4. Update the Code

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
