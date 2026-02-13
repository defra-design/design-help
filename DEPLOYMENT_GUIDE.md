# Deploying to Heroku (Defra Instance)

Yes, **Heroku fully supports PostgreSQL**. In fact, it is their default database.

Here is a step-by-step guide to deploying this application to the Defra Heroku environment.

## 1. Prepare the App

Ensure your code is committed to Git.

## 2. Create the Heroku App

Assuming you are using the Heroku CLI (and are logged into the Defra account):

```bash
heroku create defra-design-help
```

## 3. Add the Database (Crucial Step)

You must explicitly "provision" the database. This attaches a fresh, empty PostgreSQL database to your app.

```bash
heroku addons:create heroku-postgresql:hobby-dev
```

*(Note: For the official Defra account, you might use a different plan than `hobby-dev`, but the command logic is the same).*

## 4. Set Environment Variables

We need to tell the live server the secrets we use locally.

**Session Secret** (Generate a long random string for this):

```bash
heroku config:set SESSION_SECRET=complex_random_string_here
```

**Node Environment**:

```bash
heroku config:set NODE_ENV=production
```

*(This ensures secure cookies are used).*

**GOV.UK Notify Keys** (If using):

```bash
heroku config:set NOTIFY_API_KEY=your_key
heroku config:set NOTIFY_TEMPLATE_ID=your_id
```

## 5. Deploy the Code

Push your local code to Heroku.

```bash
git push heroku main
```

## 6. Initialize the Database

**IMPORTANT**: When you first deploy, the database is empty. You need to run our setup script to create the tables (`users`, `profiles`).

Run this command *once* after your first deploy:

```bash
heroku run node scripts/init-db.js
```

## 7. Open the App

```bash
heroku open
```

---

## Troubleshooting

- **"Application Error"**: Run `heroku logs --tail` to see what went wrong.
- **Database Connection**: The app automatically finds the database via the `DATABASE_URL` environment variable, which Heroku sets for you automatically when you add the addon. You don't need to set this manualy.
