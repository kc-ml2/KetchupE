import { createContext} from "react";
import { AuthContextType} from "@app-types/AuthContext.types";

export const AuthContext = createContext<AuthContextType | null>(null);

