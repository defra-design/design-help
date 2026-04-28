//
// For guidance on how to add JavaScript see:
// https://prototype-kit.service.gov.uk/docs/adding-css-javascript-and-images
//

window.GOVUKPrototypeKit.documentReady(() => {
  const addHelpingBtn = document.getElementById('add-helping-row')
  const helpingTemplate = document.getElementById('helping-row-template')
  const helpingContainer = document.getElementById('helping-rows')
  if (addHelpingBtn && helpingTemplate && helpingContainer) {
    const maxHelpingRows = 25
    addHelpingBtn.addEventListener('click', () => {
      const n = helpingContainer.querySelectorAll('[data-helping-row]').length
      if (n >= maxHelpingRows) {
        return
      }
      const row = helpingTemplate.content.cloneNode(true)
      helpingContainer.appendChild(row)
      if (n + 1 >= maxHelpingRows) {
        addHelpingBtn.style.display = 'none'
      }
    })
  }
})
