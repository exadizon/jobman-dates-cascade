"use server"

import { cookies } from "next/headers"

export async function login(prevState: any, formData: FormData) {
  const password = formData.get("password") as string
  if (password === "InspireKitchens") {
    const cookieStore = await cookies()
    cookieStore.set("site_auth_token", "InspireKitchens", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: "/",
    })
    return { success: true, error: null }
  } else {
    return { success: false, error: "Incorrect password" }
  }
}
