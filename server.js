'use strict';

require('dotenv').config()
const express = require('express')
const line = require('@line/bot-sdk')
const PORT = process.env.PORT || 3000;
const JSONParseError = require('@line/bot-sdk').JSONParseError
const SignatureValidationFailed = require('@line/bot-sdk').SignatureValidationFailed
const serviceAccount = require('./cert/line-bot-1-db31c-firebase-adminsdk-fvg52-b875c77a0c.json')
const admin = require("firebase-admin")
const translate = require('./translate')
const Fukkin = require('./fukkin')

//fire base認証初期化
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://line-bot-1-db31c.firebaseio.com'
})



//dbの参照取得
const db = admin.firestore()
const collection = db.collection('users')

//line　初期化用アクセストークン
const config = {
  channelSecret: process.env.LINEBOT_CHANNEL_SECRET,
  channelAccessToken: process.env.LINEBOT_ACCESS_TOKEN
}

//expressルーティング指定(/webhookで受ける)
const app = express()

app.post('/webhook', line.middleware(config), async (req, res) => {
    Promise
      .all(req.body.events.map(handleEvent))
      .then(result => res.json(result))
})

//line sdk初期化(clientを通してメッセージを送る)
const client = new line.Client(config);

//メインの処理
async function handleEvent(event) {

  //テキスト以外は処理しない
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  const message = event.message.text
  const replyToken = event.replyToken

  const userId = event.source.userId
  const doc = collection.doc(userId)
  const snapShot = await getSnapShot(doc)

  //「マスターしたかも」でテストモード開始
  if (snapShot && snapShot.word && message === 'マスターしたかも') {
    const current = await startExsam(doc, snapShot)
    return pushMsg(userId, 'おっじゃテストしますか').then(async () => {
      const answer = parseAnswer(current.answer, 'array')
      await startTest(doc, answer)
      return reply(replyToken, current.word)
    })   
  }

  //テストモード
  if (snapShot.test && snapShot.test.start) {
    const isCorrect = snapShot.test.answer.includes(message)
    const isGiveUp = message === 'ごめん、教えてください'
    const isExsamGiveUp = message === 'ごめん、やっぱテスト無理'
    const shuldUpdateExsam = snapShot.exsam && snapShot.exsam.start && (isCorrect || isGiveUp)
    let answer;
    let nextAnswer;
    let current;

    if (isExsamGiveUp) {
      finishExsam(doc)
      return reply(replyToken, 'おつ！')
    }

    if (shuldUpdateExsam) {
      console.log('shuldUpdateExsam', shuldUpdateExsam)
      current = await updateExsam(doc, snapShot)
      nextAnswer = current ? parseAnswer(current.answer, 'array') : current
    }

    //腹筋スタート
    if (isGiveUp) {
      setTimeout(() => {
        pushMsg(userId, '腹筋スタート!')
        new Fukkin(5, count => {
          pushMsg(userId, `${count}!`)
        }, async () => {
          answer = parseAnswer(snapShot.test.answer)
          await pushMsg(userId, `おつ!`)
          updateTest(doc, nextAnswer)
          await pushMsg(userId, `ほれ!\n${answer}`).then(() => {
            return afterReplyAnswer(shuldUpdateExsam, nextAnswer, replyToken, current ? current.word : null)
          })
        })
      }, 2000)
      return pushMsg(userId, '腹筋5回やったら教えてあげる!')
    }

    if (isCorrect) {
      answer = parseAnswer(snapShot.test.answer)
      const replyMsg = `正解！\n他にもこんな感じで翻訳できたり\n\n${answer}`
      updateTest(doc, nextAnswer)
      return pushMsg(userId, replyMsg).then(() => {
        return afterReplyAnswer(shuldUpdateExsam, nextAnswer, replyToken, current ? current.word : null)
      })
    }

    return pushMsg(userId, '違うなー')
  }

  //テストモード以外のときの日本語への返し
  if (!isOnlyAlphabet(message)) {
    return reply(replyToken, '日本語では？')
  }

  const alreadyRegistered = await hasWord(snapShot, message)

  //一度登録した単語の時返し
  //テストモード開始
  if (alreadyRegistered) {
    const answer = snapShot.word[message].split('\n').map(item => item.replace(/^・/, ''))
    await startTest(doc, answer)
    return reply(replyToken, 'この前教えたーよ\n思い出してみ')
  }

  //以降通常の翻訳の返し

  pushMsg(userId, 'ちょい待ち！')

  let translated = await translate(message)
  const word = {text: message, translated}

  await registerWord(doc, word)
  await pushMsg(userId, translated)
  return reply(replyToken, 'だよー')
}

async function startExsam(doc, snapShot) {
  const list = Object.keys(snapShot.word)
  const current = {word: list[0], answer: snapShot.word[list[0]]}
  await doc.set({
    exsam: {
      start: true,
      current: {word: list[0], answer: snapShot.word[list[0]]},
      list
    }
  }, {merge: true})
  return current
}

async function updateExsam(doc, snapShot) {
  const _list = [...snapShot.exsam.list]
  _list.shift()
  const start = _list.length > 0
  const exsam = {
    start,
    current: start ? {word: _list[0], answer: snapShot.word[_list[0]]} : null,
    list: start ? _list : null
  }
  await doc.set({exsam}, {merge: true})
  return exsam.current
}

function finishExsam(doc) {
  doc.set({
    exsam: {
      start: false,
      current: null,
      list: null
    },
    test: {
      start: false
    }
  }, {merge: true})
}

async function startTest(doc, answer) {
  await doc.set({
    test: {start: true, answer},
  }, {merge: true})
}

function updateTest(doc, nextAnswer) {
  const shouldContinue = nextAnswer !== undefined && nextAnswer !== null
  doc.set({
    test: {
      start: shouldContinue ? true : false,
      answer: shouldContinue ? nextAnswer : []
    },
  }, {merge: true})
}

async function registerWord(doc, word) {
  await doc.set({
    word: { [word.text]: word.translated}
  }, {merge: true})
}

function isOnlyAlphabet(word) {
  return /^[a-zA-z\s]+$/.test(word)
}

function getSnapShot(doc) {
  return doc.get().then(doc => {
    return doc.data()
  })
}

function hasWord(snapShot, text) {
  if (!snapShot) return false
  return snapShot.word && snapShot.word[text] ? true : false
}

function parseAnswer(answer, to) {
  if (to === 'array') {
    return answer.split('\n').map(item => item.replace(/^・/, ''))
  } else {
    return answer.map(item => `・${item}`).join('\n')
  }
}

function afterReplyAnswer(shuldUpdateExsam, nextAnswer, replyToken, nextQuestion) {
  return nextAnswer ? 
    reply(replyToken, nextQuestion) : 
    shuldUpdateExsam ? reply(replyToken, 'お疲れーこれで全部だよー') : Promise.resolve()
}

function reply(replyToken, message) {
  return client.replyMessage(replyToken, {
    type: 'text',
    text: message
  })
}

function pushMsg(userId, message) {
  return client.pushMessage(userId, {
    type: 'text',
    text: message,
  })
}

app.use((err, req, res, next) => {
  if (err instanceof SignatureValidationFailed) {
    res.status(401).send(err.signature)
    return
  } else if (err instanceof JSONParseError) {
    res.status(400).send(err.raw)
    return
  }
  next(err) // will throw default 500
})

app.listen(PORT)

console.log(`Server running at ${PORT}`);