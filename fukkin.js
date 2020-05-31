const Obniz = require('obniz')
const obnizId = process.env.OBNIZ_ID
const distanceSencerName = 'HC-SR04'
const servoName = 'ServoMotor'

class Fukkin{
  constructor(howMany, onCount, onFinish) {
    this.start(onCount)
    this.onFinish = onFinish
    this.howMany = howMany
  }

  start(onCount) {
    this.initObniz()
    this.obniz.onconnect = () => {
      this.startCount(onCount)
    }
    this.count = 0
  }

  initObniz() {
    const obniz = new Obniz(obnizId, {
      auto_connect: false,
      reset_obniz_on_ws_disconnection: false
    })
    obniz.connect()
    this.obniz = obniz
  }

  close() {
    this.obniz.close()
  }

  initSencer() {
    this.distanceSencer = this.obniz.wired(distanceSencerName, {gnd:8, echo:9, trigger:10, vcc:11})
    this.servo = this.obniz.wired(servoName, {gnd:0, vcc:1, signal:2})
    this.distanceSencer.temp = 26
  }

  async startCount(onCount) {
    this.initSencer()
    let currentAngle = 0
    let lastAngle = 0
    //体を起こした時の最大距離
    const minDistance = 1000

    let isLean = true
    const detectLean = (distance) => {
      //体を倒した状態の時は常にtrue
      //体を起こしきって初めて距離の判定をする(isLean = falseになるので)
      return isLean || distance > minDistance
    }
    while(this.count < this.howMany) {
      const distance = await this.distanceSencer.measureWait()
      isLean = detectLean(distance)
      currentAngle = distance > minDistance ? 90 : 0

      console.log(distance)

      if (currentAngle !== lastAngle) {
        console.log(currentAngle)
        this.servo.angle(currentAngle)
        lastAngle = currentAngle
      }

      //体を起こしてから倒しきるまでは距離がminDistance以下であってもカウントしない
      if (distance && distance <= minDistance && isLean) {
        ++this.count
        isLean = false
        onCount(this.count)
        await this.obniz.wait(1500)
      }
    }
    this.servo.angle(90)
    this.onFinish(this.count)
    this.close()
  }
}

module.exports = Fukkin