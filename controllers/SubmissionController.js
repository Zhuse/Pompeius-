const { body, validationResult } = require('express-validator');
const { sanitizeBody } = require('express-validator');
const mongoose = require('mongoose');
const Submission = require('../models/SubmissionModel');
const Match = require('../models/MatchModel');
const apiResponse = require('../helpers/apiResponse');
const auth = require('../middlewares/jwt');
const httpHelpers = require('../helpers/httpHelpers');

mongoose.set('useFindAndModify', false);

// Submission Schema
function SubmissionData(data) {
    this.id = data._id;
    this.language_id = data.language_id;
    this.source_code = data.source_code;
    this.user = data.user;
    this.time = data.time;
    this.match = data.match;
    this.memory = data.memory;
    this.stderr = data.stderr;
    this.stdin = data.stdin;
    this.stdout = data.stdout;
    this.token = data.token;
    this.compile_output = data.compile_output;
    this.message = data.message;
    this.status = data.status;
}

function generateScore(matchStats, execResult) {
    const factor = 10000;
    const hourInms = 60 * 60 * 1000;
    const timeScore = Math.max(1 - ((Date.now() - matchStats.started.getTime()) / hourInms), 0);
    const execScore = 1;
    const memoryScore = 1;
    return factor * (timeScore * 0.5 + execScore * 0.25 + memoryScore * 0.25);
}
/**
 * Submission List.
 *
 * @returns {Object}
 */
exports.submissionList = [
    auth,
    function (req, res) {
        try {
            Submission.find({ user: req.user._id }).then((submissions) => {
                if (submissions.length > 0) {
                    return apiResponse.successResponseWithData(res, 'Operation success', submissions);
                }
                return apiResponse.successResponseWithData(res, 'Operation success', []);
            });
        } catch (err) {
            // throw error in json response with status 500.
            return apiResponse.ErrorResponse(res, err);
        }
    },
];

/**
 * Submission Detail.
 *
 * @param {string}      id
 *
 * @returns {Object}
 */
exports.submissionDetail = [
    auth,
    function (req, res) {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return apiResponse.successResponseWithData(res, 'Operation success', {});
        }
        try {
            Submission.findOne({ _id: req.params.id, user: req.user._id }).then((submission) => {
                if (submission !== null) {
                    const submissionData = new SubmissionData(submission);
                    return apiResponse.successResponseWithData(res, 'Operation success', submissionData);
                }
                return apiResponse.successResponseWithData(res, 'Operation success', {});
            });
        } catch (err) {
            // throw error in json response with status 500.
            return apiResponse.ErrorResponse(res, err);
        }
    },
];

/**
 * Submission store.
 *
 * @param {string}      source_code
 * @param {string}      language_id
 * @param {string}      stdin
 * @param {string}      user
 * @param {string}      match
 * @returns {Object}
 */
exports.submissionStore = [
    auth,
    body('language_id', 'Must choose a language').custom((value) => {
        if (value >= 1 || value <= 44) {
            return true;
        }
        throw new Error('Invalid Language');
    }),
    body('user', 'User must not be empty').isLength({ min: 1 }).trim(),
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                throw new Error('Something wrong happened. Please try again later.');
            }
            const execResult = await httpHelpers.post('/submissions', {
                source_code: req.body.source_code,
                language_id: req.body.language_id,
                stdin: req.body.stdin
            })
            const submission = new Submission(
                {
                    language_id: req.body.language_id,
                    source_code: req.body.source_code,
                    stdin: req.body.stdin,
                    user: req.body.user,
                    match: req.body.match,
                    time: execResult.time,
                    memory: execResult.memory,
                    stdout: execResult.stdout,
                    stderr: execResult.stderr,
                    token: execResult.token,
                    compile_output: execResult.compile_output,
                    message: execResult.message,
                    status: execResult.status
                }
            );

            const matchStats = await Match.findOne({ _id: req.body.match });
            const playerScore = (!execResult.stderr && !execResult.compile_output)? generateScore(matchStats, execResult): 0;
            // Determine the player number
            let matchP1 = await Match.findOne({$and: [{ _id: req.body.match }, { player1: req.body.user }]});
            let matchP2 = await Match.findOne({$and: [{ _id: req.body.match }, { player2: req.body.user }]});
            
            
            if (matchP1 && !matchP2) {

                /** Is player one */
                await Match.findOneAndUpdate({ $and: [{ _id: req.body.match }, { player1: req.body.user }] },
                    { player1Score: Math.max(matchP1.player1Score, playerScore) });
            } else if (!matchP1 && matchP2) {

                /** Is player two */
                await Match.findOneAndUpdate({ $and: [{ _id: req.body.match }, { player2: req.body.user }] },
                    { player2Score: Math.max(matchP2.player2Score, playerScore) });
            } else {

                /** Match not found or player is somehow bother players in the same match */
                throw new Error ('Something went really wrong.');
            }

            // Save submission.
            submission.save((err) => {
                if (err) { return apiResponse.ErrorResponse(res, err); }
                const submissionData = new SubmissionData(submission);
                return apiResponse.successResponseWithData(res, 'Submission add Success.', submissionData);
            });
        } catch (err) {
            console.log(err)
            // throw error in json response with status 500.
            return apiResponse.ErrorResponse(res, err);
        }
    },
];

/**
 * Submission Delete.
 *
 * @param {string}      id
 *
 * @returns {Object}
 */
exports.submissionDelete = [
    auth,
    function (req, res) {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return apiResponse.validationErrorWithData(res, 'Invalid Error.', 'Invalid ID');
        }
        try {
            Submission.findById(req.params.id, (err, foundSubmission) => {
                if (foundSubmission === null) {
                    return apiResponse.notFoundResponse(res, 'Submission not exists with this id');
                }
                // Check authorized user
                if (foundSubmission.user.toString() !== req.user._id) {
                    return apiResponse.unauthorizedResponse(res, 'You are not authorized to do this operation.');
                }
                // delete submission.
                Submission.findByIdAndRemove(req.params.id, (err) => {
                    if (err) {
                        return apiResponse.ErrorResponse(res, err);
                    }
                    return apiResponse.successResponse(res, 'Submission delete Success.');
                });
            });
        } catch (err) {
            // throw error in json response with status 500.
            return apiResponse.ErrorResponse(res, err);
        }
    },
];
