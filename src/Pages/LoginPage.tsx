import React, {
  useState,
  useRef,
  useContext,
  forwardRef,
  useImperativeHandle,
} from "react";
import { useLocation } from "react-router-dom";
import { AuthContext } from "@Contexts/AuthContext";
import { AuthContextType } from "@app-types/AuthContext.types";
import Loading from "@Features/Shared/components/Loading";
import KetchupE from "@images/main.png";

interface OTPInputProps {
  length?: number;
  onComplete: (code: string) => void;
}

interface OTPInputRef {
  clear: () => void;
}

const OTPInput = forwardRef<OTPInputRef, OTPInputProps>(function OTPInput(
  { length = 6, onComplete },
  ref,
) {
  const [otp, setOtp] = useState<string[]>(new Array(length).fill(""));
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleChange = (index: number, value: string) => {
    if (!/^[0-9]?$/.test(value)) return;

    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);

    if (value && index < length - 1) {
      inputRefs.current[index + 1]?.focus();
    }

    if (newOtp.every((digit) => digit !== "")) {
      onComplete(newOtp.join(""));
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const clearOtp = () => {
    setOtp(new Array(length).fill(""));
    inputRefs.current[0]?.focus();
  };

  useImperativeHandle(ref, () => ({
    clear: clearOtp,
  }));

  return (
    <div className="flex gap-2 mt-2 mb-2">
      {otp.map((value, index) => (
        <input
          key={index}
          ref={(el: HTMLInputElement | null) => {
            if (el) inputRefs.current[index] = el;
          }}
          value={value}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          className="w-12 h-12 text-2xl text-center border border-gray-300 rounded focus:border-primary focus:outline-none bg-white text-gray-900"
          maxLength={1}
        />
      ))}
    </div>
  );
});

function LoginPage() {
  const otpRef = useRef<OTPInputRef>(null);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState(false);
  const [showOTP, setShowOTP] = useState(false);
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  // const [serverUrl, setServerUrl] = useState(() => {
  //   return localStorage.getItem("serverUrl") || "https://chat-dev.kcsoftmax.com";
  // });

  const { login, fetchClient } = useContext(AuthContext) as AuthContextType;
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const from = params.get("from") || "/chatbot";

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setEmail(value);
    setEmailError(!validateEmail(value));
    setServerError(null);
  };

  const handleLogin = async () => {
    if (email) {
      setLoading(true);
      setServerError(null);
      try {
        const response = await fetchClient.post<string>(
          "/auth/login",
          { email },
          { attachDeviceId: true },
        );
        setEmail(response);
        setShowOTP(true);
      } catch (error: unknown) {
        console.error("Login error:", error);
        const err = error as {
          message?: string;
          response?: { status?: number };
        };
        if (
          err?.message?.includes("fetch") ||
          err?.message?.includes("Network") ||
          !err?.response
        ) {
          setServerError(
            "Cannot connect to server. Please check the Workspace Server URL.",
          );
        } else if (err?.response?.status && err.response.status >= 500) {
          setServerError("Server error occurred. Please try again later.");
        } else if (
          err?.response?.status === 400 ||
          err?.response?.status === 404
        ) {
          setServerError("Invalid request. Please check your email address.");
        } else {
          setServerError("An error occurred. Please try again.");
        }
      } finally {
        setLoading(false);
      }
    }
  };

  const handleComplete = async (otpCode: string) => {
    setLoading(true);
    try {
      const response = await fetchClient.post<string>(
        "/auth/verify/code",
        {
          email,
          code: otpCode,
        },
        { attachDeviceId: true },
      );
      login(response, from, email);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  // const handleServerUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  //   const value = e.target.value;
  //   setServerUrl(value);
  //   localStorage.setItem("serverUrl", value);
  //   import.meta.env.VITE_API_URL = value;
  //   setServerError(null);
  // };

  return (
    <div className="min-h-screen bg-white flex flex-col items-center gap-6 pt-12 px-4 relative">
      <img src={KetchupE} alt="MARU" className="h-20 w-auto" />
      <h1 className="text-2xl font-bold text-gray-900">케찹이 서비스</h1>
      <h2 className="text-lg text-gray-500">Sign in to KetchupE chatbot</h2>
      {!showOTP ? (
        <div className="flex flex-col w-full max-w-md gap-4">
          <div className="flex flex-col">
            <label className="font-bold mb-2 text-gray-900">사내 이메일</label>
            <input
              type="email"
              className={`p-2 text-base border rounded bg-white text-gray-900 ${emailError ? "border-red-500" : "border-gray-300"}`}
              placeholder="사내 이메일 주소를 입력해 주세요"
              value={email}
              onChange={handleEmailChange}
            />
            {emailError && (
              <span className="text-red-500 text-sm mt-1">
                Please enter a valid email address.
              </span>
            )}
          </div>

          {loading ? (
            <Loading comment="Authenticating..." />
          ) : (
            <button
              className="p-3 bg-primary text-white rounded font-bold disabled:bg-gray-300 disabled:cursor-not-allowed"
              onClick={handleLogin}
              disabled={email.length < 2 || emailError}
            >
              Continue
            </button>
          )}

          <div className="flex flex-col pt-4 border-t border-gray-200">
            {/* <label className="font-bold mb-2 text-sm text-gray-900">Workspace Server URL</label>
            <input
              type="text"
              className={`p-2 text-sm border rounded bg-white text-gray-900 ${
                serverError ? 'border-red-500' : 'border-gray-300'
              }`}
              placeholder="https://chat-dev.kcsoftmax.com"
              value={serverUrl}
              onChange={handleServerUrlChange}
            /> */}
            {serverError ? (
              <span className="text-xs text-red-500 mt-1 flex items-start gap-1">
                <span>⚠️</span>
                <span>{serverError}</span>
              </span>
            ) : (
              <span className="text-xs text-gray-400 mt-1">
                Enter server URL. Leave empty to use default.
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="w-full max-w-md">
          <h2 className="text-lg text-gray-900 text-center mb-4">
            Enter Verification Code
          </h2>
          <p className="text-sm text-gray-500 text-center mb-4">
            We sent a verification code to {email}
          </p>
          <div className="flex flex-col items-center">
            <OTPInput ref={otpRef} onComplete={handleComplete} />
            {loading && <Loading comment="Verifying..." />}

            {!loading && (
              <div className="flex gap-3 mt-6 w-full">
                <button
                  onClick={() => {
                    setShowOTP(false);
                    setEmail("");
                    setEmailError(false);
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-gray-700"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    otpRef.current?.clear();
                    setLoading(true);
                    try {
                      await fetchClient.post<string>(
                        "/auth/login",
                        { email },
                        { attachDeviceId: true },
                      );
                    } catch (error) {
                      console.error("Resend error:", error);
                    } finally {
                      setLoading(false);
                    }
                  }}
                  className="flex-1 px-4 py-2 bg-primary text-white rounded-lg hover:bg-[#0056b3] transition-colors font-medium"
                >
                  Resend Code
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default LoginPage;
