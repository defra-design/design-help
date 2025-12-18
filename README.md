# Design Help - Team Connection Platform

A GOV.UK Prototype Kit application for connecting designers in your team for coaching, mentoring, design critiques, and mutual support.

## Features

✅ **Home Page** - Quick links to find help by category (critiques, mentoring, accessibility, etc.)  
✅ **Browse Team Members** - View all designers with their profiles, skills, and availability  
✅ **Filtering** - Filter team members by skills, interests, or what they can help with  
✅ **Individual Profiles** - Detailed profile pages showing experience, skills, and areas of expertise  
✅ **Availability Status** - See who's available or busy at a glance  
✅ **Add New Profiles** - Self-service form for team members to add their own profiles  

## Getting Started

### Prerequisites
- Node.js v16, v18, v20, or v22 (Note: You're currently running v24 which may have compatibility issues)

### Installation

```bash
npm install
```

### Running the Prototype

```bash
npm run dev
```

The prototype will be available at: http://localhost:3000

## Project Structure

```
app/
├── data/
│   └── team-members.json    # Team member profiles and information
├── routes.js                # Route handlers for browse, profile, and add pages
├── views/
│   ├── index.html          # Home page with quick links
│   ├── browse.html         # Team member listing with filtering
│   ├── profile.html        # Individual profile page
│   └── add-profile.html    # Form to add new team members
└── config.json             # Service configuration
```

## Managing Team Members

Edit `app/data/team-members.json` to add, remove, or update team member profiles.

Each team member profile includes:
- **Basic info**: name, role, location, experience
- **Skills**: areas of expertise
- **Availability**: current availability status
- **Can help with**: specific types of support offered
- **Interests**: professional interests
- **Bio**: personal introduction

Example profile structure:

```json
{
  "id": "unique-id",
  "name": "Designer Name",
  "role": "Job Title",
  "skills": ["Skill 1", "Skill 2"],
  "availability": "Available",
  "location": "City",
  "experience": "X years",
  "bio": "Short introduction...",
  "canHelpWith": ["Activity 1", "Activity 2"],
  "interests": ["Interest 1", "Interest 2"]
}
```

## Using the Application

### For Designers Seeking Help

1. **Start from the home page** - Click on what you need help with (design critique, mentoring, etc.)
2. **Browse filtered results** - See team members who can help with your specific need
3. **View profiles** - Click on a name to see detailed information
4. **Get in touch** - Contact them via Slack or email

### For Team Members Adding Themselves

1. **Go to the browse page** - Navigate to http://localhost:3000/browse
2. **Click "Add a team member"** - Opens the profile creation form
3. **Fill in your details**:
   - Full name
   - Job role
   - Location
   - Years of experience
   - About you (bio)
   - Availability status
   - Skills (comma-separated)
   - What you can help with (comma-separated)
   - Professional interests (comma-separated)
4. **Submit** - Your profile is automatically added to the system
5. **View your profile** - Click the success message link to see your new profile

### For Administrators

1. **Add new team members** - Use the form at `/add-profile` or edit `team-members.json` directly
2. **Update availability** - Edit the JSON file to change the "availability" field
3. **Customize help categories** - Edit the home page links in `views/index.html`

## Customization

### Adding New Filter Categories

Edit `app/views/index.html` to add new quick links:

```html
<li>
  <a href="/browse?filter=YourKeyword">
    Description of help type
  </a>
</li>
```

The filter will search across skills, canHelpWith, interests, role, and name fields.

### Styling

The prototype uses GOV.UK Frontend for styling. Custom styles can be added to `app/assets/sass/application.scss`.

## Next Steps

Consider adding:
- Search functionality with more advanced filters
- Booking/calendar integration
- Messaging system
- Feedback/rating system after sessions
- Analytics to track popular help topics
- Email notifications
- Admin interface for managing profiles

## Support

For GOV.UK Prototype Kit documentation: https://prototype-kit.service.gov.uk/docs

## License

See LICENCE.txt

