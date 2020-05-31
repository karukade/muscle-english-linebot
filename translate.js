const request = require('request')
const uuidv4 = require('uuid/v4')
const subscriptionKey = process.env.AZURE_SUBSCRIPTION_KEY

function translateText(text){
  let options = {
    method: 'POST',
    baseUrl: 'https://api.cognitive.microsofttranslator.com/',
    url: '/dictionary/lookup',
    qs: {
      'api-version': '3.0',
      'from': 'en',
      'to': 'ja'
    },
    headers: {
      'Ocp-Apim-Subscription-Key': subscriptionKey,
      'Content-type': 'application/json',
      'X-ClientTraceId': uuidv4().toString()
    },
    body: [{text}],
    json: true,
  }
  return req(options)
}

function req(options) {
  return new Promise(resolve => {
    request(options, function(err, res, body){
      const translatedItems = body[0].translations.map(item => {
        return `・${item.displayTarget}`
      })
      resolve(translatedItems.join('\n'))
    })
  })
}

module.exports = translateText