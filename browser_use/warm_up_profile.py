#!/usr/bin/env python3
"""
Profile warm-up script to maintain Gmail login status

Run this script once to manually log in to Gmail,
then the login information will be saved in the browser profile
for the AI agent to use later.

Usage:
1. Run python warm_up_profile.py
2. Log in to Gmail in the opened browser (all methods including passkey, 2FA available)
3. Exit script after login completion
4. AI agent will then use this login status
"""

import os
import asyncio
from playwright.async_api import async_playwright
import logging

# Logging setup
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def warm_up_gmail_profile():
    """Warm up Gmail profile to save login status"""
    
    # Profile directory (use same path as server.py)
    profile_dir = os.path.join(os.getcwd(), "browser_profile")
    
    logger.info(f"🔥 Gmail profile warm-up start - Profile: {profile_dir}")
    logger.info("📋 This script is for saving Gmail login status.")
    logger.info("🔐 Please log in to Gmail in the opened browser (all methods including passkey, 2FA available)")
    
    async with async_playwright() as p:
        # Launch browser (specify profile directory)
        browser = await p.chromium.launch_persistent_context(
            user_data_dir=profile_dir,
            headless=False,  # Show browser for user to log in directly
            args=[
                '--no-first-run',
                '--no-default-browser-check',
                '--disable-blink-features=AutomationControlled'
            ]
        )
        
        # Create new page
        page = await browser.new_page()
        
        try:
            # Access Gmail
            logger.info("🌐 Accessing Gmail...")
            await page.goto('https://mail.google.com', wait_until='networkidle')
            
            logger.info("✋ Please log in to Gmail in the browser!")
            logger.info("🔑 Use any method: passkey, 2-factor authentication, password, etc.")
            logger.info("✅ Press Enter after login completion...")
            
            # Wait for user input
            input("Press Enter after login completion...")
            
            # Check login status
            try:
                # Check if Gmail interface is loaded
                await page.wait_for_selector('[role="main"]', timeout=10000)
                logger.info("✅ Gmail login status successfully saved!")
                logger.info(f"📁 Profile location: {profile_dir}")
                logger.info("🤖 AI agent can now use this login status.")
                
            except Exception as e:
                logger.warning(f"⚠️ Gmail interface check failed: {str(e)}")
                logger.info("🔄 Login may not be completed. Please try again.")
                
        except Exception as e:
            logger.error(f"❌ Error occurred: {str(e)}")
            
        finally:
            logger.info("🔚 Closing browser...")
            await browser.close()

def main():
    """Main function"""
    print("=" * 60)
    print("🔥 Gmail Profile Warm-up Script")
    print("=" * 60)
    print()
    print("Purpose of this script:")
    print("1. Manually log in to Gmail once")
    print("2. Save login status to browser profile")
    print("3. AI agent will use this login status later")
    print()
    print("Notes:")
    print("- Supports all login methods including passkey, 2-factor authentication")
    print("- Please press Enter after login")
    print("- Profile will be saved in browser_profile/ folder")
    print()
    
    try:
        asyncio.run(warm_up_gmail_profile())
    except KeyboardInterrupt:
        print("\n⚠️ Interrupted by user.")
    except Exception as e:
        print(f"\n❌ Error occurred: {str(e)}")

if __name__ == "__main__":
    main() 