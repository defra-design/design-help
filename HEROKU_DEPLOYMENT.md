# Heroku Deployment Guide

## Password Protection Setup

Your prototype is now configured for Heroku deployment with password protection.

### Setting Up Password on Heroku

You need to set environment variables in Heroku to enable password protection:

#### Option 1: Via Heroku Dashboard (Easiest)
1. Go to your Heroku app dashboard: https://dashboard.heroku.com/apps/YOUR-APP-NAME
2. Click on **Settings** tab
3. Click **Reveal Config Vars**
4. Add these variables:

```
NODE_ENV = production
USE_AUTH = true
USERNAME = design-team
PASSWORD = choose-a-secure-password
```

#### Option 2: Via Heroku CLI
If you have Heroku CLI installed, run these commands:

```bash
heroku config:set NODE_ENV=production
heroku config:set USE_AUTH=true
heroku config:set USERNAME=design-team
heroku config:set PASSWORD=your-secure-password
```

### After Setting Variables

Once you've set the config vars:
1. Your next git push will automatically deploy
2. Users will be prompted for username/password
3. Everyone on your team uses the same credentials

### Important Notes

⚠️ **Data Persistence Warning:**
- The "Add Profile" form will NOT persist data on Heroku
- Any profiles added through the form will disappear when Heroku restarts (every 24 hours)
- Only the profiles in your `team-members.json` file (in git) will persist

**Options:**
1. **Remove the add profile form** for now (safest)
2. **Use it knowing data is temporary** (for testing)
3. **Implement Google Sheets** (for permanent storage)

### Testing Locally with Password

To test password protection locally:

1. Create a `.env` file in your project root (DON'T commit this):
```
NODE_ENV=production
USE_AUTH=true
USERNAME=design-team
PASSWORD=test123
```

2. Run your prototype:
```bash
npm start
```

3. Visit http://localhost:3000 - you'll be prompted for login

### Deployment Steps

Since you've set up auto-deploy from GitHub:

1. Commit these changes:
```bash
git add .
git commit -m "Add Heroku configuration and password protection"
git push origin main
```

2. Heroku will automatically deploy

3. Set your config vars (see above)

4. Visit your Heroku app URL

### Recommended: Disable Add Profile Form

To prevent confusion about data persistence, you may want to hide the add profile button:

Edit `app/views/browse.html` and remove or comment out the "Add a team member" button.

### Need Google Sheets Integration?

If you want profiles added through the form to persist, let me know and I can implement Google Sheets storage.

