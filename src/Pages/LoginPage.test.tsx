import { describe, it, expect, vi, beforeEach, Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import LoginPage from './LoginPage'
import { AuthContext } from '@Contexts/AuthContext'
import { AuthContextType } from '@app-types/AuthContext.types'
import { FetchClientAPI } from '@app-types/fetchClient.types'

const mockLogin = vi.fn()
const mockPost = vi.fn() as Mock
const mockFetchClient: FetchClientAPI = {
  get: vi.fn(),
  post: mockPost,
  patch: vi.fn(),
  postFormData: vi.fn(),
  postStream: vi.fn(),
  del: vi.fn(),
}

const mockAuthContext: AuthContextType = {
  user: null,
  isAuthenticated: false,
  login: mockLogin,
  logout: vi.fn(),
  fetchClient: mockFetchClient,
  getTokenPayload: vi.fn().mockReturnValue(null),
  getAccessToken: vi.fn().mockReturnValue(null),
  isInitializing: false,
  updateUserName: vi.fn(),
}

const renderLoginPage = (authContext = mockAuthContext, initialEntry = '/login') => {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/login" element={
          <AuthContext.Provider value={authContext}>
            <LoginPage />
          </AuthContext.Provider>
        } />
      </Routes>
    </MemoryRouter>
  )
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Initial Render', () => {
    it('should render login page with correct title', () => {
      renderLoginPage()
      expect(screen.getByText('⚖️ KC LLM Service')).toBeInTheDocument()
      expect(screen.getByText('Sign in to your workspace')).toBeInTheDocument()
    })

    it('should render email input field', () => {
      renderLoginPage()
      const emailInput = screen.getByPlaceholderText('Enter your email address...')
      expect(emailInput).toBeInTheDocument()
      expect(emailInput).toHaveAttribute('type', 'email')
    })

    it('should render continue button disabled by default', () => {
      renderLoginPage()
      const continueButton = screen.getByRole('button', { name: 'Continue' })
      expect(continueButton).toBeInTheDocument()
      expect(continueButton).toBeDisabled()
    })
  })

  describe('Email Validation', () => {
    it('should enable continue button with valid KC Group email', async () => {
      const user = userEvent.setup()
      renderLoginPage()
      
      const emailInput = screen.getByPlaceholderText('Enter your email address...')
      await user.type(emailInput, 'test@kct.co.kr')
      
      const continueButton = screen.getByRole('button', { name: 'Continue' })
      expect(continueButton).toBeEnabled()
    })

    it('should show error for invalid email format', async () => {
      const user = userEvent.setup()
      renderLoginPage()
      
      const emailInput = screen.getByPlaceholderText('Enter your email address...')
      await user.type(emailInput, 'invalid-email')
      
      expect(screen.getByText('Please check the email format. Only KC Group employees can use this service.')).toBeInTheDocument()
      const continueButton = screen.getByRole('button', { name: 'Continue' })
      expect(continueButton).toBeDisabled()
    })

    it('should show error for non-KC Group email domain', async () => {
      const user = userEvent.setup()
      renderLoginPage()
      
      const emailInput = screen.getByPlaceholderText('Enter your email address...')
      await user.type(emailInput, 'test@gmail.com')
      
      expect(screen.getByText('Please check the email format. Only KC Group employees can use this service.')).toBeInTheDocument()
      const continueButton = screen.getByRole('button', { name: 'Continue' })
      expect(continueButton).toBeDisabled()
    })

    it('should accept all valid KC Group domains', async () => {
      const user = userEvent.setup()
      const validDomains = [
        'kct.co.kr',
        'kctech.co.kr',
        'kcenc.co.kr',
        'kcinnovation.co.kr',
        'kcindustrial.com',
        'kcpartstech.co.kr',
      ]

      for (const domain of validDomains) {
        const { unmount } = renderLoginPage()
        const emailInput = screen.getByPlaceholderText('Enter your email address...')
        await user.type(emailInput, `test@${domain}`)
        
        const continueButton = screen.getByRole('button', { name: 'Continue' })
        expect(continueButton).toBeEnabled()
        unmount()
      }
    })
  })

  describe('Login Flow', () => {
    it('should call login API when continue is clicked', async () => {
      const user = userEvent.setup()
      mockPost.mockResolvedValueOnce('test@kct.co.kr')
      renderLoginPage()
      
      const emailInput = screen.getByPlaceholderText('Enter your email address...')
      await user.type(emailInput, 'test@kct.co.kr')
      
      const continueButton = screen.getByRole('button', { name: 'Continue' })
      await user.click(continueButton)
      
      expect(mockPost).toHaveBeenCalledWith(
        '/auth/login',
        { email: 'test@kct.co.kr' },
        { attachDeviceId: true }
      )
    })

    it('should show loading state during login', async () => {
      const user = userEvent.setup()
      mockPost.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)))
      renderLoginPage()
      
      const emailInput = screen.getByPlaceholderText('Enter your email address...')
      await user.type(emailInput, 'test@kct.co.kr')
      
      const continueButton = screen.getByRole('button', { name: 'Continue' })
      await user.click(continueButton)
      
      expect(screen.getByText('인증 중입니다...')).toBeInTheDocument()
    })

    it('should show OTP input after successful login', async () => {
      const user = userEvent.setup()
      mockPost.mockResolvedValueOnce('test@kct.co.kr')
      renderLoginPage()
      
      const emailInput = screen.getByPlaceholderText('Enter your email address...')
      await user.type(emailInput, 'test@kct.co.kr')
      
      const continueButton = screen.getByRole('button', { name: 'Continue' })
      await user.click(continueButton)
      
      await waitFor(() => {
        expect(screen.getByText('Enter Verification Code')).toBeInTheDocument()
      })
    })

    it('should handle login error', async () => {
      const user = userEvent.setup()
      mockPost.mockRejectedValueOnce(new Error('Login failed'))
      renderLoginPage()
      
      const emailInput = screen.getByPlaceholderText('Enter your email address...')
      await user.type(emailInput, 'test@kct.co.kr')
      
      const continueButton = screen.getByRole('button', { name: 'Continue' })
      await user.click(continueButton)
      
      await waitFor(() => {
        expect(screen.getByText('Please check the email format. Only KC Group employees can use this service.')).toBeInTheDocument()
      })
    })
  })

  describe('OTP Verification', () => {
    it('should render 6 OTP input fields', async () => {
      const user = userEvent.setup()
      mockPost.mockResolvedValueOnce('test@kct.co.kr')
      renderLoginPage()
      
      const emailInput = screen.getByPlaceholderText('Enter your email address...')
      await user.type(emailInput, 'test@kct.co.kr')
      await user.click(screen.getByRole('button', { name: 'Continue' }))
      
      await waitFor(() => {
        const otpInputs = screen.getAllByRole('textbox')
        expect(otpInputs).toHaveLength(6)
      })
    })

    it('should auto-focus next input when entering OTP', async () => {
      const user = userEvent.setup()
      mockPost.mockResolvedValueOnce('test@kct.co.kr')
      renderLoginPage()
      
      const emailInput = screen.getByPlaceholderText('Enter your email address...')
      await user.type(emailInput, 'test@kct.co.kr')
      await user.click(screen.getByRole('button', { name: 'Continue' }))
      
      await waitFor(() => {
        const otpInputs = screen.getAllByRole('textbox')
        expect(otpInputs).toHaveLength(6)
      })
      
      const otpInputs = screen.getAllByRole('textbox')
      await user.type(otpInputs[0], '1')
      expect(otpInputs[1]).toHaveFocus()
    })

    it('should only accept numeric input for OTP', async () => {
      const user = userEvent.setup()
      mockPost.mockResolvedValueOnce('test@kct.co.kr')
      renderLoginPage()
      
      const emailInput = screen.getByPlaceholderText('Enter your email address...')
      await user.type(emailInput, 'test@kct.co.kr')
      await user.click(screen.getByRole('button', { name: 'Continue' }))
      
      await waitFor(() => {
        const otpInputs = screen.getAllByRole('textbox')
        expect(otpInputs).toHaveLength(6)
      })
      
      const otpInputs = screen.getAllByRole('textbox') as HTMLInputElement[]
      await user.type(otpInputs[0], 'a')
      expect(otpInputs[0].value).toBe('')
      
      await user.type(otpInputs[0], '1')
      expect(otpInputs[0].value).toBe('1')
    })

    it('should handle backspace to previous input', async () => {
      const user = userEvent.setup()
      mockPost.mockResolvedValueOnce('test@kct.co.kr')
      renderLoginPage()
      
      const emailInput = screen.getByPlaceholderText('Enter your email address...')
      await user.type(emailInput, 'test@kct.co.kr')
      await user.click(screen.getByRole('button', { name: 'Continue' }))
      
      await waitFor(() => {
        const otpInputs = screen.getAllByRole('textbox')
        expect(otpInputs).toHaveLength(6)
      })
      
      const otpInputs = screen.getAllByRole('textbox')
      await user.type(otpInputs[0], '1')
      await user.type(otpInputs[1], '2')
      
      otpInputs[2].focus()
      await user.keyboard('{Backspace}')
      expect(otpInputs[1]).toHaveFocus()
    })

    it('should submit OTP when all fields are filled', async () => {
      const user = userEvent.setup()
      mockPost
        .mockResolvedValueOnce('test@kct.co.kr')
        .mockResolvedValueOnce({ token: 'mock-token' })
      
      renderLoginPage()
      
      const emailInput = screen.getByPlaceholderText('Enter your email address...')
      await user.type(emailInput, 'test@kct.co.kr')
      await user.click(screen.getByRole('button', { name: 'Continue' }))
      
      await waitFor(() => {
        const otpInputs = screen.getAllByRole('textbox')
        expect(otpInputs).toHaveLength(6)
      })
      
      const otpInputs = screen.getAllByRole('textbox')
      for (let i = 0; i < 6; i++) {
        await user.type(otpInputs[i], String(i + 1))
      }
      
      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledWith(
          '/auth/verify/code',
          {
            email: 'test@kct.co.kr',
            code: '123456',
          },
          { attachDeviceId: true }
        )
      })
      
      expect(mockLogin).toHaveBeenCalledWith({ token: 'mock-token' }, '/chatbot')
    })

    it('should show loading state during OTP verification', async () => {
      const user = userEvent.setup()
      mockPost
        .mockResolvedValueOnce('test@kct.co.kr')
        .mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)))
      
      renderLoginPage()
      
      const emailInput = screen.getByPlaceholderText('Enter your email address...')
      await user.type(emailInput, 'test@kct.co.kr')
      await user.click(screen.getByRole('button', { name: 'Continue' }))
      
      await waitFor(() => {
        const otpInputs = screen.getAllByRole('textbox')
        expect(otpInputs).toHaveLength(6)
      })
      
      const otpInputs = screen.getAllByRole('textbox')
      for (let i = 0; i < 6; i++) {
        await user.type(otpInputs[i], String(i + 1))
      }
      
      await waitFor(() => {
        expect(screen.getByText('로그인 중입니다...')).toBeInTheDocument()
      })
    })
  })

  describe('Redirect URL', () => {
    it('should use from parameter for redirect after login', async () => {
      const user = userEvent.setup()
      mockPost
        .mockResolvedValueOnce('test@kct.co.kr')
        .mockResolvedValueOnce({ token: 'mock-token' })
      
      renderLoginPage(mockAuthContext, '/login?from=/admin')
      
      const emailInput = screen.getByPlaceholderText('Enter your email address...')
      await user.type(emailInput, 'test@kct.co.kr')
      await user.click(screen.getByRole('button', { name: 'Continue' }))
      
      await waitFor(() => {
        const otpInputs = screen.getAllByRole('textbox')
        expect(otpInputs).toHaveLength(6)
      })
      
      const otpInputs = screen.getAllByRole('textbox')
      for (let i = 0; i < 6; i++) {
        await user.type(otpInputs[i], String(i + 1))
      }
      
      await waitFor(() => {
        expect(mockLogin).toHaveBeenCalledWith({ token: 'mock-token' }, '/admin')
      })
    })

    it('should default to /chatbot if no from parameter', async () => {
      const user = userEvent.setup()
      mockPost
        .mockResolvedValueOnce('test@kct.co.kr')
        .mockResolvedValueOnce({ token: 'mock-token' })
      
      renderLoginPage()
      
      const emailInput = screen.getByPlaceholderText('Enter your email address...')
      await user.type(emailInput, 'test@kct.co.kr')
      await user.click(screen.getByRole('button', { name: 'Continue' }))
      
      await waitFor(() => {
        const otpInputs = screen.getAllByRole('textbox')
        expect(otpInputs).toHaveLength(6)
      })
      
      const otpInputs = screen.getAllByRole('textbox')
      for (let i = 0; i < 6; i++) {
        await user.type(otpInputs[i], String(i + 1))
      }
      
      await waitFor(() => {
        expect(mockLogin).toHaveBeenCalledWith({ token: 'mock-token' }, '/chatbot')
      })
    })
  })
})