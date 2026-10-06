// Baseline for legacy reports; published edits are stored separately.
export const DEFAULT_CAPTAIN_TEMPLATE = {
  "revision": 0,
  "introduction": "Complete every required question marked with an asterisk. Use N/A when a section does not apply.",
  "sections": [
    {
      "key": "staff",
      "title": "Staff",
      "description": "Staffing, uniforms, appearance, and team performance.",
      "fields": [
        {
          "key": "staffEnough",
          "label": "Did you have enough staff to run a successful event?",
          "type": "choice",
          "options": [
            "Yes",
            "No"
          ],
          "required": true
        },
        {
          "key": "staffingResponsive",
          "label": "Was the Staffing Department responsive and helpful?",
          "type": "choice",
          "options": [
            "Yes",
            "No"
          ],
          "required": true
        },
        {
          "key": "staffingComments",
          "label": "Please explain any staffing concerns or requests.",
          "type": "textarea"
        },
        {
          "key": "uniformsReturned",
          "label": "Were all uniforms returned?",
          "type": "choice",
          "options": [
            "Yes",
            "No",
            "Uniform was provided by the client",
            "N/A",
            "Other"
          ],
          "required": true
        },
        {
          "key": "uniformCheckInOut",
          "label": "Who checked out uniforms, and who signed uniforms back in?",
          "type": "text"
        },
        {
          "key": "staffAppearance",
          "label": "Did staff appearance (grooming and uniform) meet OCC standards?",
          "type": "choice",
          "options": [
            "Yes",
            "No",
            "Other"
          ],
          "required": true
        },
        {
          "key": "staffAppearanceComments",
          "label": "If someone did not meet OCC standards, provide their name and details.",
          "type": "textarea"
        },
        {
          "key": "positiveStaff",
          "label": "Please list any staff members who stood out in a positive way.",
          "type": "textarea"
        },
        {
          "key": "staffBelowStandards",
          "label": "Please list any staff members who did not meet OCC standards.",
          "type": "textarea"
        }
      ]
    },
    {
      "key": "kitchen",
      "title": "Kitchen",
      "description": "Food quality, timing, presentation, and kitchen leadership.",
      "fields": [
        {
          "key": "foodProvidedByOcc",
          "label": "Was food provided by OCC?",
          "type": "choice",
          "options": [
            "Yes",
            "No"
          ],
          "required": true
        },
        {
          "key": "leadChefName",
          "label": "Lead Chef's name",
          "type": "text"
        },
        {
          "key": "foodMetStandards",
          "label": "Did the food meet OCC standards for presentation, timing, and quality?",
          "type": "choice",
          "options": [
            "Yes",
            "No",
            "N/A"
          ],
          "required": true
        },
        {
          "key": "foodStandardsComments",
          "label": "Explain any food presentation, timing, or quality concerns.",
          "type": "textarea"
        },
        {
          "key": "leadChefCooperative",
          "label": "Was the Lead Chef cooperative and proactive?",
          "type": "choice",
          "options": [
            "Yes",
            "No",
            "N/A"
          ],
          "required": true
        },
        {
          "key": "leadChefComments",
          "label": "Please explain any concerns regarding the Lead Chef.",
          "type": "textarea"
        },
        {
          "key": "kitchenPerformanceComments",
          "label": "List any comments or concerns about food service and/or kitchen performance.",
          "type": "textarea"
        }
      ]
    },
    {
      "key": "bar",
      "title": "Bar",
      "description": "Beverage product, service standards, and inventory counts.",
      "fields": [
        {
          "key": "barProductProvidedByOcc",
          "label": "Was beverage/bar product provided by OCC?",
          "type": "choice",
          "options": [
            "Yes",
            "No"
          ],
          "required": true
        },
        {
          "key": "barServiceMetStandards",
          "label": "Did beverage service/bar management meet OCC standards?",
          "type": "choice",
          "options": [
            "Yes",
            "No"
          ],
          "required": true
        },
        {
          "key": "barServiceComments",
          "label": "If not, please explain.",
          "type": "textarea"
        },
        {
          "key": "barProductEnough",
          "label": "Did you have enough bar product to maintain beverage service throughout the event?",
          "type": "choice",
          "options": [
            "Yes",
            "No"
          ],
          "required": true
        },
        {
          "key": "beverageCountsCompleted",
          "label": "Were beverage counts completed before and after the event?",
          "type": "choice",
          "options": [
            "Yes",
            "No"
          ],
          "required": true
        }
      ]
    },
    {
      "key": "sanitation",
      "title": "Sanitation / Rentals",
      "description": "Rental quantities and sanitation leadership.",
      "fields": [
        {
          "key": "sanitationCaptainName",
          "label": "Sanitation Captain's name",
          "type": "text"
        },
        {
          "key": "rentalEquipmentEnough",
          "label": "Did you have enough rental equipment for the event?",
          "type": "choice",
          "options": [
            "Yes",
            "No",
            "N/A"
          ],
          "required": true
        },
        {
          "key": "rentalEquipmentComments",
          "label": "Please explain any rental shortages or issues.",
          "type": "textarea"
        },
        {
          "key": "sanitationCooperative",
          "label": "Was the Sanitation Captain/Assistant cooperative and helpful?",
          "type": "choice",
          "options": [
            "Yes",
            "No",
            "N/A"
          ],
          "required": true
        },
        {
          "key": "sanitationComments",
          "label": "Please explain any sanitation concerns.",
          "type": "textarea"
        }
      ]
    },
    {
      "key": "venue",
      "title": "Venue Notes",
      "description": "Information that will help future teams work at this venue.",
      "fields": [
        {
          "key": "venueAccessNotes",
          "label": "Add venue address details such as staff meeting location, service entrance, and loading dock.",
          "type": "textarea"
        },
        {
          "key": "venueKitchenNotes",
          "label": "Add kitchen/BOH details such as paper requirements, open-flame rules, and whether frying is allowed.",
          "type": "textarea"
        },
        {
          "key": "finalWalkthrough",
          "label": "Who completed the final walkthrough? Was a client present?",
          "type": "textarea",
          "required": true
        }
      ]
    },
    {
      "key": "feedback",
      "title": "Event Satisfaction / Client's Feedback",
      "description": "Event results, overtime, safety, and follow-up.",
      "fields": [
        {
          "key": "actualGuestCount",
          "label": "What was the actual guest count? Give your best estimate compared with the paperwork.",
          "type": "text",
          "inputMode": "numeric",
          "required": true
        },
        {
          "key": "rerunsOrPurchases",
          "label": "Were there re-runs or purchases made for the event?",
          "type": "choice",
          "options": [
            "Yes, there were re-runs",
            "No re-runs that I am aware of"
          ],
          "required": true
        },
        {
          "key": "rerunsDetails",
          "label": "If yes, list how many re-runs were made and which items were needed.",
          "type": "textarea"
        },
        {
          "key": "paperworkAccurate",
          "label": "Did the event paperwork properly reflect the flow and needs of the event?",
          "type": "choice",
          "options": [
            "Yes",
            "No"
          ],
          "required": true
        },
        {
          "key": "paperworkComments",
          "label": "Please explain any paperwork issues.",
          "type": "textarea"
        },
        {
          "key": "partyExtended",
          "label": "Was the party extended?",
          "type": "choice",
          "options": [
            "Yes",
            "No",
            "I do not know"
          ],
          "required": true
        },
        {
          "key": "partyExtendedComments",
          "label": "If yes, please provide details.",
          "type": "textarea"
        },
        {
          "key": "staffStayedLate",
          "label": "Did any staff members stay past their scheduled out time?",
          "type": "choice",
          "options": [
            "Yes",
            "No",
            "I do not know"
          ],
          "required": true
        },
        {
          "key": "staffStayedLateComments",
          "label": "If yes, list the staff members and additional time.",
          "type": "textarea"
        },
        {
          "key": "prepWorkTimeAdded",
          "label": "Did you add time for prep work or anything else to the event hours?",
          "type": "choice",
          "options": [
            "Yes",
            "No",
            "Other"
          ],
          "required": true
        },
        {
          "key": "prepWorkTimeComments",
          "label": "If yes or other, list how much time was added and why.",
          "type": "textarea"
        },
        {
          "key": "healthSafetyIssues",
          "label": "OCC Health & Safety: Were there any issues with health and safety on-site?",
          "type": "choice",
          "options": [
            "Yes",
            "No"
          ],
          "required": true
        },
        {
          "key": "healthSafetyComments",
          "label": "If yes, please explain.",
          "type": "textarea"
        },
        {
          "key": "overallFeedback",
          "label": "Give your overall feedback and list anything else the Sales Rep or office should know.",
          "type": "textarea",
          "required": true
        },
        {
          "key": "followUpRequired",
          "label": "Management follow-up is required",
          "type": "checkbox"
        }
      ]
    }
  ]
};
