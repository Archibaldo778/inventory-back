// Original kitchen questions remain the fallback for reports without a saved template.
export const DEFAULT_KITCHEN_TEMPLATE = {
  "revision": 0,
  "introduction": "Complete every required question marked with an asterisk. Use N/A when a section does not apply.",
  "sections": [
    {
      "key": "staff",
      "title": "Staff",
      "description": "Kitchen staffing, punctuality, appearance, tools, and teamwork.",
      "fields": [
        {
          "key": "staffLate",
          "label": "Was any of the staff late?",
          "type": "choice",
          "options": [
            "Yes",
            "No"
          ],
          "required": true
        },
        {
          "key": "staffLateWho",
          "label": "If so, who?",
          "type": "textarea"
        },
        {
          "key": "staffProperlyDressed",
          "label": "Was the staff properly dressed (shoes polished, pants pressed, chef jacket clean, etc.)?",
          "type": "choice",
          "options": [
            "Yes",
            "No"
          ],
          "required": true
        },
        {
          "key": "staffDressIssues",
          "label": "If no, who?",
          "type": "textarea"
        },
        {
          "key": "staffFollowedDirection",
          "label": "Did the staff follow direction and communicate with the Lead Chef?",
          "type": "choice",
          "options": [
            "Yes",
            "No"
          ],
          "required": true
        },
        {
          "key": "staffDirectionIssues",
          "label": "If no, who?",
          "type": "textarea"
        },
        {
          "key": "staffSizeAppropriate",
          "label": "Was staff size appropriate for the event?",
          "type": "choice",
          "options": [
            "Yes",
            "No"
          ],
          "required": true
        },
        {
          "key": "staffSizeComments",
          "label": "If no, why?",
          "type": "textarea"
        },
        {
          "key": "staffBroughtTools",
          "label": "Did all staff provide their own knives/tools for the event?",
          "type": "choice",
          "options": [
            "Yes",
            "No"
          ],
          "required": true
        },
        {
          "key": "staffToolsMissing",
          "label": "If no, who?",
          "type": "textarea"
        },
        {
          "key": "staffComments",
          "label": "Provide additional staff comments, including strengths, concerns, who you would work with again, and recommendations for future events.",
          "type": "textarea",
          "required": true
        }
      ]
    },
    {
      "key": "equipment",
      "title": "Equipment",
      "description": "Rental and kitchen equipment completeness and condition.",
      "fields": [
        {
          "key": "rentalsReceived",
          "label": "Did you receive all the rentals you needed? If no, what was missing?",
          "type": "textarea",
          "required": true
        },
        {
          "key": "rentalsWorking",
          "label": "Were the rentals properly working (proofers, convection ovens, etc.)? If no, what was not working?",
          "type": "textarea",
          "required": true
        },
        {
          "key": "kitchenEquipmentReceived",
          "label": "Did you receive all equipment/tools from the kitchen that you needed? If no, what was missing?",
          "type": "textarea",
          "required": true
        }
      ]
    },
    {
      "key": "service",
      "title": "Service / Kitchen",
      "description": "Food quantities, quality, timing, communication, paperwork, and safety.",
      "fields": [
        {
          "key": "choiceEntreeService",
          "label": "Did the event offer choice of entree service?",
          "type": "choice",
          "options": [
            "No",
            "Yes",
            "Other"
          ],
          "required": true
        },
        {
          "key": "choiceEntreeDetails",
          "label": "If yes, list the total entree count and count for each option (example: 100 total — 35 chicken, 65 beef).",
          "type": "textarea"
        },
        {
          "key": "foodEnough",
          "label": "Did you have enough food? If no, why?",
          "type": "textarea",
          "required": true
        },
        {
          "key": "foodQuality",
          "label": "Was the food quality up to standards? If no, why?",
          "type": "textarea",
          "required": true
        },
        {
          "key": "foodOnTime",
          "label": "Was the food served on time? If no, why?",
          "type": "textarea",
          "required": true
        },
        {
          "key": "fohKitchenCommunication",
          "label": "Was there good communication/teamwork between the front of house staff and the kitchen? If no, why?",
          "type": "textarea",
          "required": true
        },
        {
          "key": "otherIssues",
          "label": "Provide any additional comments, positive or negative, on other issues.",
          "type": "textarea",
          "required": true
        },
        {
          "key": "paperworkLeadTime",
          "label": "Did you receive paperwork and answers to your questions with enough lead time to plan appropriately? If no, what was missing?",
          "type": "textarea",
          "required": true
        },
        {
          "key": "paperworkAccurate",
          "label": "Did the paperwork reflect the actual flow and needs of the event? If no, what should change?",
          "type": "textarea",
          "required": true
        },
        {
          "key": "healthSafetyIssues",
          "label": "Were there any issues with OCC Health & Safety?",
          "type": "choice",
          "options": [
            "Yes",
            "No"
          ],
          "required": true
        },
        {
          "key": "healthSafetyFeedback",
          "label": "Provide feedback regarding OCC Health & Safety on-site.",
          "type": "textarea",
          "required": true
        },
        {
          "key": "concernsImprovements",
          "label": "Concerns / Improvements",
          "type": "textarea",
          "required": true
        }
      ]
    },
    {
      "key": "final",
      "title": "Final Evaluation",
      "description": "Purchases, overtime, prep time, photos, and overall evaluation.",
      "fields": [
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
          "label": "If yes, describe how many re-runs were made and which items were needed.",
          "type": "textarea"
        },
        {
          "key": "overtime",
          "label": "Was there overtime?",
          "type": "choice",
          "options": [
            "Yes, there was overtime",
            "No, there was no overtime",
            "I do not know"
          ],
          "required": true
        },
        {
          "key": "overtimeDetails",
          "label": "If yes, list how many staff members stayed over and for how long.",
          "type": "textarea"
        },
        {
          "key": "prepWorkTimeAdded",
          "label": "Did you add time for prep work or this report to your event hours?",
          "type": "choice",
          "options": [
            "Yes",
            "No",
            "Other"
          ],
          "required": true
        },
        {
          "key": "prepWorkTimeDetails",
          "label": "If yes or other, list how much time was added.",
          "type": "textarea"
        },
        {
          "key": "photoLinks",
          "label": "Event photo links (optional, one link per line)",
          "type": "textarea"
        },
        {
          "key": "overallEvaluation",
          "label": "Overall Event Evaluation",
          "type": "textarea",
          "required": true
        }
      ]
    }
  ]
};
