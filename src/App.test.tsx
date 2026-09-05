import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import App from './App'

test('increments the counter', async () => {
  const user = userEvent.setup()

  render(<App />)

  await user.click(screen.getByRole('button', { name: 'Count is 0' }))

  expect(screen.getByRole('button', { name: 'Count is 1' })).toBeInTheDocument()
})
