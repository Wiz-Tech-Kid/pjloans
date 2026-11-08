import { createClient } from '@supabase/supabase-js'
import process from 'node:process'

const projectUrl = 'https://uwkajgkrbdfdldhjdxuu.supabase.co'
const userId = '2ffb7e7b-fb80-4aec-b648-43b87e530e70'

function askHidden(prompt: string): Promise<string> {
  const input = process.stdin

  if (!input.isTTY) {
    throw new Error('Run this in VS Code’s integrated Terminal, not the Code Runner output panel.')
  }

  return new Promise((resolve, reject) => {
    let value = ''

    const finish = () => {
      input.off('data', onData)
      input.setRawMode(false)
      input.pause()
      process.stdout.write('\n')
    }

    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\u0003') {
          finish()
          reject(new Error('Cancelled.'))
          return
        }

        if (char === '\r' || char === '\n') {
          finish()
          resolve(value)
          return
        }

        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1)
        } else if (char >= ' ') {
          value += char
        }
      }
    }

    process.stdout.write(prompt)
    input.setRawMode(true)
    input.resume()
    input.on('data', onData)
  })
}

async function main() {
  const secretKey = (await askHidden('Paste your Supabase secret API key (input hidden): ')).trim()
  if (!secretKey) throw new Error('No secret key was entered.')

  const password = await askHidden('Enter the new admin password (input hidden): ')
  const passwordAgain = await askHidden('Enter it again to confirm (input hidden): ')

  if (password.length < 12) {
    throw new Error('Choose a password at least 12 characters long.')
  }
  if (password !== passwordAgain) {
    throw new Error('The passwords did not match.')
  }

  const supabase = createClient(projectUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  const { error } = await supabase.auth.admin.updateUserById(userId, {
    password,
    email_confirm: true,
  })

  if (error) throw error

  console.log('Success: the admin password is set and the email is confirmed.')
  console.log('You can now sign in to your app with that account and password.')
}

main().catch((error) => {
  console.error(`Failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})