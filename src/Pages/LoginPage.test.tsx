import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import LoginPage from "./LoginPage";
import { AuthContext } from "@Contexts/AuthContext";
import { AuthContextType } from "@app-types/AuthContext.types";

const post = vi.fn();
const login = vi.fn();
const authContext = {
  user: null,
  isAuthenticated: false,
  login,
  logout: vi.fn(),
  fetchClient: {
    get: vi.fn(),
    post,
    patch: vi.fn(),
    postFormData: vi.fn(),
    del: vi.fn(),
  },
  getTokenPayload: vi.fn().mockReturnValue(null),
  getAccessToken: vi.fn().mockReturnValue(null),
  isInitializing: false,
  updateUserName: vi.fn(),
} as AuthContextType;

const renderLoginPage = () =>
  render(
    <MemoryRouter initialEntries={["/login?from=/team/1"]}>
      <AuthContext.Provider value={authContext}>
        <LoginPage />
      </AuthContext.Provider>
    </MemoryRouter>,
  );

describe("LoginPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("현재 로그인 화면을 렌더링한다", () => {
    renderLoginPage();

    expect(screen.getByRole("heading", { name: "케찹이 서비스" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("사내 이메일 주소를 입력해 주세요")).toHaveAttribute(
      "type",
      "email",
    );
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("이메일과 인증 코드를 서버에 보내고 로그인한다", async () => {
    const user = userEvent.setup();
    post.mockResolvedValueOnce("user@kct.co.kr").mockResolvedValueOnce("token");
    renderLoginPage();

    await user.type(
      screen.getByPlaceholderText("사내 이메일 주소를 입력해 주세요"),
      "user@kct.co.kr",
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText("Enter Verification Code")).toBeInTheDocument();
    for (const [index, input] of screen.getAllByRole("textbox").entries()) {
      await user.type(input, String(index + 1));
    }

    await waitFor(() => {
      expect(post).toHaveBeenLastCalledWith(
        "/auth/verify/code",
        { email: "user@kct.co.kr", code: "123456" },
        { attachDeviceId: true },
      );
      expect(login).toHaveBeenCalledWith("token", "/team/1", "user@kct.co.kr");
    });
  });
});
