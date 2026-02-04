# Topics

- Module 0 - Course Introduction
    - Overview
        - Introduction
        - Learning Objectives
        - Terminology
- Module 1 - Prompt Engineering
    - Role, Goal Context
        - Role
        - Goal
        - Context
    - Prompting Strategies
        - Few Shot Prompting
        - Iterative Prompting
    - Planning Ahead
        - Plan First
        - Plan Modes
- Module 2 - Context Engineering
    - Understanding Context
        - Context Window
        - Context Rot
        - Context Engineering
    - Remembering Context
        - AGENT.md
        - Compactions
        - Structured Notes
    - Finding Context
        - File Discovery
        - Specialisation
- Module 3 - Agent Development
    - Agents
        - Models
        - Skills
        - Model Context Protocol
        - Subagents
- Module 4 - Responsible AI
    - Security Vulnerabilities
        - SQL Injection
        - Secrets
        - Slopsquatting
        - Context Poisoning
    - Paper Trail
        - AI Disclosures
        - AI Signatures
    - Governance & Standards
        - Moonshot
        - AI Verify Toolkit
- Module 5 - AI Minded Technology Stack
    - Code Quality
        - Code Formatters
        - Type Checkers
        - Linting
        - Code Review
    - MCPs & Tools
        - MCPs
        - Custom Tools
    - Technology Choices
        - Object Relationship Mappers (ORM)
        - Monorepos
        - Documentation with Markdown
- Module 6 - AI Powered Development
    - Development Cycle - Git
        - Deployment
        - Workflows
        - Spec Driven Development
        - Test Driven Development
- Module 7 - AI Enhanced Debugging & Testing
    - Debugging
        - Debugging Tips
        - Debugging Tools
    - Testing
        - Unit Tests
        - Integration Tests
        - Testing Tools
- Module 8 - AI Assisted Documentation
    - Documentation
        - Cunksode Documentation
        - Text to Diagram
- Module 9 - Agentic Product Development
    - Agentic Development Cycle
        - Chlosed loops


# Module 0 - Course Introduction

# Overview

# Introduction

# Learning Objectives

# Terminology

# Module 1 - Prompt Engineering

# Role, Goal Context

# Introduction


Pretend that you are an AI agent for a moment. You are given the following prompt:

```
Write me a function that returns the most popular movie in 2025.
```

How would you go about performing this task?

Most of us would immediately ask follow up questions.
- What programming language?
- Any specific genre?
- How do you define popularity?
- Any specific dataset?

How do you want the output to be structured?

There was insufficient information in the prompt for us to execute on it, which was why we asked follow up questions. However, AI agents often lack this initiative and will frequently go off on assumptions - leading to unexpected results and a lot of frustration.

In order to prevent this, we need to ensure that our prompts are as precise as possible.

## Role, Goal, Context

The Role, Goal, Context framework is a structured approach to writing more precise prompts. While there are many different approaches to writing a prompt, RGC provides a good balance in terms of verbosity, making it a good default.

In the following pages, we will explore RGC in more detail.
# Role

Roles are defined sets of responsibilities, capabilities, and behavioral patterns that guide how an agent operates. A role specifies:

- Responsibilities - What tasks or functions the agent is accountable for
- Permissions - What actions the agent is authorized to take
- Constraints - Limitations on what the agent can do
- Expertise - Domain knowledge and specialized capabilities
- Communication patterns - How the agent interacts with other agents or users

## Overriding Roles

Most AI assisted coding tools default to using "You are a helpful assistant" in the system prompt. Sometimes, you might want to override this by providing a role of your own. For example:

```
You are a Senior Engineer specialised in FastAPI.
```

Adding this to the previous prompt,

```
You are a Senior Engineer specialised in FastAPI. Write me a function that returns the most popular movie in 2025.
```

With just a single sentence, we can now infer:

- It should probably be a Python function.
- It should follow best practices and coding conventions.
- It should be performant and scalable.

## Effects of roles

As mentioned previously, roles define the behavioural patterns of an agent which can be useful for keeping the AI focused for longer and throughout memory compactions.

Take for example the following exchange:

```
Dev: Write me a Python function that returns the most popular movie in 2025. Make sure that you use type hints and docstrings.

Agent: <completes task>

Dev: Ok, now lets work on the React front end to use this FastAPI function.

<a long discussion about front end without any Python>...

Dev: Write me another function that returns the most popular tv series in 2025.

<agent has forgotten about type hinting and docstrings due to the long discussion>
```

Because the prompt was too specific, it got forgotten when the context was switched from back end to front end. In contrast, roles are much more likely to survive across multiple interactions, allowing that behaviour to persist across long conversations and tangents.

```
You are a Senior Engineer specialised in FastAPI. Write me a function that returns the most popular movie in 2025. <agent implicitly adds type hinting and docstrings from Senior Engineer role>

Agent: <completes task>

Dev: Ok, now lets work on the React front end to use this FastAPI function.

<agent continues work on the front end with the Senior Engineer role, still following best practices>

Dev: Write me another function that returns the most popular tv series in 2025.

<agent still remembers the Senior Engineer role and simply changes the context from front end to back end>
```

## Should you override roles?

Roles are useful because their generic nature makes them much more likely to survive long interactions. If you override a role with a more specific one, it may not last as long. Thus, a good strategy would be to stick to the default and only use roles when you want a specific behaviour consistently.

Later on, when we explore the use of subagents will we make much better use of roles.

# Goal

Goals are what you expect the AI to do. The more specific you are, the higher the chance that the agent will do what you want. Lets go through some specific scenarios of how to write more precise goals.

## Point to sources

When you first start out in a fresh codebase, it might be small enough for the agent to read the whole thing, but as your codebase grows, reading everything becomes unfeasible. As such, directing the agent to the right sources can help to make the goals more precise.

| |PROMPT |
|---------|---|
| **BAD** | Write a function to get the most popular movie. |
| **GOOD** | Update api.py to include a function that gets the most popular movie. |
| **BAD** | Find the file with the function that gets the most popular movie. |
| **GOOD** | Look through the recent commits to find the function that gets the most popular movie. |

When utilising external sources, make sure to be explicit about it.

| Prompt | Description |
|--------|-------------|
| **BAD** | Write a function to get the most popular movie. |
| **GOOD** | Use the movies db api to create a function that gets the most popular movie. |
| **BETTER** | Use https://developer.themoviedb.org/reference/movie-popular-list to create a function that gets the most popular movie. |

## Scope out tasks

By default, once you initialise an agent in the current directory, it has access to every file within it. As such, there is usually no need to tell it explicitly to read the codebase - it should be able to do it automatically. However, when dealing with external services or resources, then it is less apparent. As such, you should be more explicit when specifically talking about external services.

```
Read the the movies db api then write a function that uses the api to get the most popular movie in 2025.
```

## Defining Success

One way to be even more precise in your prompt is to be explicit about what a success scenario looks like. For example,

```

Read the the movies db api then write a function that uses the api to get the most popular movie in 2025. Run it and check that the output is "Ne Zha 2".
```

You can even use unit tests to push this idea even further:

```
Read the the movies db api then write a function that uses the api to get the most popular movie in 2025. Make sure that it passes the unit test check_most_popular_movie().
```

Using unit tests like this is what we call creating a closed loop. By giving the agent the ability to test on an interface, we allow it to work iteratively in a loop until it can come up with a valid solution. This approach is especially critical for large and complex tasks that are difficult to complete in 1 shot.

Later in the course, we will take a look at various other ways to introduce closed loops into our agentic workflow.
# Context

Sometimes, giving the why instead of just the what can help the AI better understand your requirements and automatically make rational decisions about how to handle ambiguity.

For example, telling the AI that your application is in the medical domain might help it to make reasonable assumptions that privacy and safety are of utmost importance.

Often times, you want to give the AI as much context as necessary to accomplish the task it is assigned.# Prompting Strategies

# Few Shot Prompting

When an agent is able to complete the task within the first try without any specific guidance, it is called zero-shot prompting. On the other hand, when we provide examples to help guide the agent, this approach is called few shot prompting. Just like a human, when you provide demonstrations, the agent is able to use that to produce better results in subsequent settings.

An example of how this can be used in AI assisted coding - build out a single instance of the feature and then ask the agent to repeat it in different contexts.

```
I have implemented the card component for showing the number of open issues. Do the same for the following metrics in the dashboard: 
- closed 
- high priority 
- blocked
```

Refactoring is another good use case for few shot prompting.

```
Refactor the other functions in /api to follow the formatting in model_example_function()
```

You can leverage official documentation for few shot prompting as well.

```
Can you see how query parameters are done in https://fastapi.tiangolo.com/tutorial/query-params/ and implement it in our function?  
```

You can even few shot prompt larger tasks if you can find a model reference.

```
I cloned the repo for a tutorial on how to implement a scroll to top button with scroll percentage in /scroll_to_top_button_tutorial. Can you implement a similar feature in our project?  
```
# Iterative Prompting

For large and complex tasks, a zero shot prompt might be too challenging for the AI to handle. In situations like these, it might make sense to break up the task into smaller ones and to work on the task iteratively.

For example, when working on a new feature you might consider breaking it up into the front end, back end and database.

Starting with the database:

```
I want to build a feature that lets students sign up to courses. Lets start with the database schema. Design a schema for such a feature.
```

Then, progressively move to the backend:

```
Okay, lets now use the schema you designed to build a backend API service.
```

And finally, the front end:

```
With the backend API that we just built, build a front end interface that integrates with those services.
```

Iterative prompting can also be useful in helping the AI understand and break down complex business requirements.

```
I'm building a system for a PC business. This business allows customers to customise almost everything about their PC - the case, motherboard, cpu, gpu etc.
```

Think about how such a system could be developed and ask clarifying questions if necessary.

```
The developer and AI can go back and forth in exploring and understanding the requirements.

AI: What kinds of configurations are allowed? Do we check case size specifications to make sure that the parts can fit? ...

Dev: No, that it outside the scope of the current system. A customer support rep will send a follow up email to the customer if they choose a configuration that doesn't fit ...

...
```


# Planning Ahead

# Plan First

# Plan Modes

# Module 2 - Context Engineering

# Understanding Context

# Context Window

# Context Rot

# Context Engineering

# Remembering Context

# AGENT.md

# Compactions

# Structured Notes

# Finding Context

# File Discovery

# Specialisation

# Module 3 - Agent Development

# Agents

# Models

# Skills

# Model Context Protocol

# Subagents

# Module 4 - Responsible AI

# Security Vulnerabilities

# SQL Injection

# Secrets

# Slopsquatting

# Context Poisoning

# Paper Trail

# AI Disclosures

# AI Signatures

# Governance & Standards

# Moonshot

# AI Verify Toolkit

# Module 5 - AI Minded Technology Stack

# Code Quality

# Code Formatters

# Type Checkers

# Linting

# Code Review

# MCPs & Tools

# MCPs

# Custom Tools

# Technology Choices

# Object Relationship Mappers (ORM)

# Monorepos

# Documentation with Markdown

# Module 6 - AI Powered Development

# Development Cycle - Git

# Deployment

# Workflows

# Spec Driven Development

# Test Driven Development

# Module 7 - AI Enhanced Debugging & Testing

# Debugging

# Debugging Tips

# Debugging Tools

# Testing

# Unit Tests

# Integration Tests

# Testing Tools

# Module 8 - AI Assisted Documentation

# Documentation

# Code Documentation

# Text to Diagram

# Module 9 - Agentic Product Development

# Agentic Development Cycle

# Closed Loops



























