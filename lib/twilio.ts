import twilio from 'twilio'

const accountSid = process.env.TWILIO_ACCOUNT_SID
const authToken = process.env.TWILIO_AUTH_TOKEN
const whatsappNumber = process.env.TWILIO_WHATSAPP_NUMBER

if (!accountSid || !authToken || !whatsappNumber) {
    if (process.env.NODE_ENV === 'production') {
        throw new Error(
            'Missing required Twilio environment variables. ' +
            'Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_WHATSAPP_NUMBER.'
        )
    }
    console.warn('Missing Twilio environment variables - WhatsApp operations will fail')
}

const client = twilio(accountSid || '', authToken || '')

export async function sendWhatsAppMessage(to: string, body: string) {
    try {
        return await client.messages.create({
            from: whatsappNumber,
            to,
            body,
        })
    } catch (error) {
        console.error('Error sending WhatsApp message:', error)
        throw error
    }
}

export async function sendWhatsAppAudio(to: string, mediaUrl: string) {
    try {
        return await client.messages.create({
            from: whatsappNumber,
            to,
            mediaUrl: [mediaUrl],
        })
    } catch (error) {
        console.error('Error sending WhatsApp audio:', error)
        throw error
    }
}
