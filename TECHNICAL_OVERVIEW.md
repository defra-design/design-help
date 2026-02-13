# How the App Works (Under the Hood)

This document explains the technology behind the "Defra Design Help" tool in simple terms. It describes where data lives, how we keep it safe, and how the different parts of the system talk to each other.

## 1. The "Engine": Node.js

Think of **Node.js** as the engine that runs the application. It handles all the logic, like:

- Serving the web pages you see.
- Processing the forms you submit.
- Checking if you are logged in.
- Talking to the database to fetch or save information.

We use the **GOV.UK Prototype Kit** as our chassis. This ensures the app looks and feels exactly like a standard government service (accessible, clear, and familiar) without us needing to build all the buttons and layouts from scratch.

## 2. The "Filing Cabinet": PostgreSQL Database

Previously, the prototype stored data in a simple text file, which meant data could easily get lost or overwritten. We have moved to a **PostgreSQL Database**.

Think of this as a highly secure, digital filing cabinet:

- **Persistence**: When you save your profile, it is written into a permanent record in the database. Even if we restart the application or upgrade the server, your data remains safe.
- **Structure**: The database enforces rules (e.g., "Every user must have a unique email"). This prevents messy data errors.
- **Backups**: In a production environment (like Heroku), this database is automatically backed up, so we never lose the community's information.

## 3. Security & The "Bouncer": Authentication

We need to make sure only the right people get in. We use a system called **Passport.js** to act as the "bouncer" at the door.

### How it keeps us safe

1. **The Guest List**: The bouncer only accepts IDs that match `@defra.gov.uk`. If you try to enter with a Gmail address, the door stays shut.
2. **Secret Codes (Hashing)**: We **never** store your actual password. Instead, we turn your password into a scrambled code (called a "hash") using best-practice security (bcrypt).
    - *Example*: If your password is "BlueSky!", we might store `Xy9#bL...`.
    - *Why?*: Even if a hacker stole our database, they wouldn't see your password, only the scrambled nonsense.
3. **Session Cookies**: Once you log in, we give your browser a temporary secure pass (a "cookie"). This proves who you are as you move from page to page, so you don't have to sign in every time you click a link.

## 4. Accessibility First

Technically, the app is built to be usable by everyone.

- **No specialized date pickers**: We use standard text boxes for dates (Day/Month/Year). This works perfectly with screen readers and keyboard navigation, unlike fancy calendar pop-ups which often break accessibility rules.
- **Semantic HTML**: The code is written in a way that standard web browsers understand perfectly, ensuring it works on old computers, mobile phones, and assistive devices alike.

## 5. Deployment & Data (Heroku)

When this application runs on the internet (e.g., on Heroku), the setup is slightly different from your laptop.

### Where is the data stored?

On Heroku, the application files (the code) are **ephemeral**. This means every time we deploy a new version or restart the server, the files are wiped clean and replaced.

**However, the database is separate.**
We use a service called **Heroku Postgres**. Think of this as a secure database server that sits next to our application.

- The app connects to it securely over the internet.
- **It is persistent**: Even if the app crashes or restarts, the database remains untouched.
- **Backups**: Heroku automatically backs up this database.

### How do I see the data?

Since you can't just open a file to see the data, you use tools to "peek" inside the database:

1. **Heroku CLI**: You can run commands like `heroku pg:psql` to type SQL queries directly.
2. **Dataclips**: Heroku has a feature called "Dataclips" that lets you share SQL query results (like a spreadsheet) with your team via a secret URL.
3. **Desktop Tools**: You can connect apps like **TablePlus** or **pgAdmin** to your Heroku database to browse tables visually, just like you would with an Excel sheet.
