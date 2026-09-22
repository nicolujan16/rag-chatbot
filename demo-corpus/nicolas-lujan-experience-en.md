# Nicolás Luján — work experience and projects (English)

## Importex Corporation

Web Developer, remote, from June 2026 to September 2026.

Designing and developing the new website for Trade360, the company's B2B software product,
defining the information architecture, responsive layout and content structure from the
ground up.

Implementing technical on-page SEO, metadata, semantic hierarchy and load time
optimization, to establish the site as the product's primary acquisition channel.

## English Empire Institute, second contract

Full Stack Developer on contract, remote, from February 2026 to April 2026. The institute's
site is englishempire.com.ar

Extended the existing system into a full ERP/LMS by adding authentication and role-based
access control across three isolated portals: Admin, Teachers and Students, for more than
1,000 active students.

Cut tuition collection time from days to minutes by integrating Mercado Pago with
webhook-driven payment confirmation, automating more than 1,000 monthly transactions.

Eliminated more than 60 hours of manual follow-up per month by building an event-driven
email notification pipeline on Firebase Cloud Functions, triggered by enrollment and
payment state changes.

## Del Interior Digital Newspaper

Full Stack Developer on contract, remote, from August 2025 to November 2025.

Built a news portal in Next.js with SSG and ISR, structured data and SEO-optimized
rendering, sustaining an LCP under 2 seconds.

Cut publishing time from hours to minutes by developing an integrated CMS for articles,
events and featured content, operated daily by 2 non-technical editors.

Designed the infrastructure on AWS Lambda with auto-scaling, eliminating server management
throughout the newspaper's operation.

## English Empire Institute, first contract

Full Stack Developer on contract, remote, from June 2024 to September 2024.

Replaced the institute's manual administrative workflow by building a React and Firebase
dashboard for creating, editing and removing courses and teaching staff.

Centralized course payments by enabling the administrative team to generate and update
payment links directly from the dashboard, with no developer involvement.

## Personal project: Spidey-Tracker

A real-time collaborative map, built with React Native, Expo, TypeScript and Supabase.

Built end to end: geolocated reporting over Google Maps, a live feed synced across devices,
and email authentication.

It includes automatic confirmation when two independent users report the same sighting
within 100 m and 5 minutes, a rule enforced in the database, not in the app.

The repository is github.com/nicolujan16/spidey-tracker

## Personal project: TuSanatorio

A voice-to-care-plan tool for a local clinic, built with Next.js, React, TypeScript and
Groq, using Whisper plus a language model.

Whisper transcribes the doctor's dictation and the model, constrained by a strict JSON
Schema, turns it into discrete care steps. The model is instructed never to add what isn't
in the transcript, and nothing reaches the patient until the doctor reviews and confirms.
Built in a 48-hour hackathon.

The repository is github.com/nicolujan16/tu-sanatorio

## Personal project: Pokernauta

Real-time multiplayer poker, built with React, Firestore and AWS Lambda.

Built the full game: tables, betting rounds and hand resolution for more than 10 concurrent
tables and more than 60 simultaneous players, with all hand evaluation and bet validation
running server-side and under 100 ms per action.

The repository is github.com/nicolujan16/poker-app

## Personal project: this RAG chatbot

The chatbot answering this question. Built with Next.js 16, InsForge, Postgres with
pgvector and OpenRouter. It answers only from the documents that were loaded into it, and
admits when it does not know.
