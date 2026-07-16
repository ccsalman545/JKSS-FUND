// src/context/ThemeContext.js
import React, { createContext, useContext, useState, useMemo } from 'react';
import { lightTheme, darkTheme } from '../theme';

const ThemeContext = createContext();

export const ThemeProvider = ({ children }) => {
  const [isDark, setIsDark] = useState(false);
  const theme = isDark ? darkTheme : lightTheme;
  const value = useMemo(
    () => ({ theme, isDark, toggle: () => setIsDark((v) => !v) }),
    [theme, isDark]
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => useContext(ThemeContext);
