//
// For guidance on how to create routes see:
// https://prototype-kit.service.gov.uk/docs/create-routes
//

const govukPrototypeKit = require('govuk-prototype-kit')
const router = govukPrototypeKit.requests.setupRouter()
const fs = require('fs')
const path = require('path')

// Load team members data
const teamMembersPath = path.join(__dirname, 'data', 'team-members.json')
let teamMembers = require('./data/team-members.json')

// Helper function to reload team members data
function reloadTeamMembers() {
  delete require.cache[require.resolve('./data/team-members.json')]
  teamMembers = require('./data/team-members.json')
  return teamMembers
}

// Browse team members page with optional filtering
router.get('/browse', function (req, res) {
  const filter = req.query.filter
  const currentMembers = reloadTeamMembers()
  let filteredMembers = currentMembers
  let filterText = null

  if (filter) {
    filterText = filter
    filteredMembers = currentMembers.filter(member => {
      // Search in skills, canHelpWith, role, and interests
      const searchFields = [
        ...member.skills,
        ...member.canHelpWith,
        ...member.interests,
        member.role,
        member.name
      ].join(' ').toLowerCase()
      
      return searchFields.includes(filter.toLowerCase())
    })
  }

  res.render('browse', {
    filteredMembers: filteredMembers,
    filterText: filterText
  })
})

// Individual profile pages
router.get('/profile/:id', function (req, res) {
  const memberId = req.params.id
  const currentMembers = reloadTeamMembers()
  const member = currentMembers.find(m => m.id === memberId)

  if (member) {
    res.render('profile', {
      member: member
    })
  } else {
    res.status(404).send('Profile not found')
  }
})

// Add profile form - GET
router.get('/add-profile', function (req, res) {
  res.render('add-profile', {
    success: false
  })
})

// Add profile form - POST
router.post('/add-profile', function (req, res) {
  // Generate a unique ID from the name
  const generateId = (name) => {
    return name.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  }

  // Helper to parse comma-separated values into array
  const parseList = (str) => {
    return str.split(',').map(item => item.trim()).filter(item => item)
  }

  // Create new profile object
  const newProfile = {
    id: generateId(req.body.name),
    name: req.body.name,
    role: req.body.role,
    skills: parseList(req.body.skills),
    availability: req.body.availability,
    location: req.body.location,
    experience: req.body.experience,
    bio: req.body.bio,
    canHelpWith: parseList(req.body.canHelpWith),
    interests: parseList(req.body.interests)
  }

  // Read current data
  const currentData = JSON.parse(fs.readFileSync(teamMembersPath, 'utf8'))
  
  // Add new profile
  currentData.push(newProfile)
  
  // Write back to file
  fs.writeFileSync(teamMembersPath, JSON.stringify(currentData, null, 2))
  
  // Reload the data
  reloadTeamMembers()

  // Redirect or show success
  res.render('add-profile', {
    success: true,
    newProfileId: newProfile.id
  })
})

// Add your routes here
