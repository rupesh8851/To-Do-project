import React, { useEffect, useState } from 'react';
import { Redirect } from 'react-router-dom';
import { Quiz as ExternalQuiz } from 'quiz-component/Quiz/Quiz';
import { useStoreState, useStoreActions } from 'easy-peasy';
import la from 'lido-tracking-script';
import { get, isEmpty } from 'lodash-es';
import queryString from 'query-string';
import cookies from 'js-cookie';
import * as Sentry from '@sentry/browser';

import { userId, isLoggedIn, isStudent } from 'utils/tokenUtils';
import * as sentryUtil from 'utils/sentry';
import quizSettings from 'utils/quizSettings';
import { routes } from 'constants/index';
import * as gemsUtils from 'utils/gemsUtils';

import { Loader } from 'components/shared';

import { ResultPage as QuizResultPage } from 'quiz-component/ResultPage/ResultPage';
import { LandingPage as QuizLandingPage } from 'quiz-component/LandingPage/LandingPage';

const Quiz = (props) => {
  const isUserLoggedIn = isLoggedIn();
  const { match } = props;
  const quizSlug = match.params.slug_id;
  let { settings } = queryString.parse(window.location.search);
  try {
    settings = JSON.parse(atob(settings));
  } catch (error) {
    settings = {};
  }

  let classProps = queryString.parse(window.location.search).class_props;
  try {
    classProps = JSON.parse(atob(classProps));
  } catch (error) {
    classProps = {};
  }

  const { vc_id } = classProps; // todo - can I access quiz without vc_id??
  const { teacher_id } = classProps; // todo - can I access quiz without teacher_id??
  const { class_start_time } = classProps;
  const {
    fetchQuizBySlug,
    updateState: updateQuizState,
    insertVcQuizTrack,
    updateVcQuizTrack,
    insertVcQuestionAssessmentTrack: saveSubQuestion,
  } = useStoreActions(actions => actions.quiz);
  const quiz = useStoreState(state => state.quiz);
  const quizDetails = get(quiz, `${quizSlug}.quizDetails`);
  const activeQuestionSlug = get(quiz, `${quizSlug}.activeQuestionSlug`);
  const { fetchQuestionsBySlugs, createQuestionIssueTicket } = useStoreActions(actions => actions.question);
  const { totalGems: totalGemsFromAPI, eventWiseGemsReward } = useStoreState(state => state.user);
  const questionDetails = useStoreState(state => get(state, `question.${activeQuestionSlug}.questionDetails`));
  const isQuestionSubmitted = useStoreState(state => get(state, `question.${activeQuestionSlug}.isQuestionSubmitted`));
  const quizStep = get(quiz, `${quizSlug}.quizStep`);
  const trackId = get(quiz, `${quizSlug}.trackId`);
  const [isCurrentQuestionSubmitted, setIsCurrentQuestionSubmitted] = useState(false);
  const [submittedQuizData, setSubmittedQuizData] = useState({});
  const [isAlreadySubmittedQuiz, setIsAlreadySubmittedQuiz] = useState(false);
  const [totalGems, setTotalGems] = useState(0);
  const [gemsReasons, setGemsReasons] = useState([]);
  const [isGemsEnabled, setIsGemsEnabled] = useState(quizSettings.enableGems);
  const passingMarks = get(quizDetails, 'passingPercentage') || 80;
  const quizStartTime = cookies.getJSON('quizStartTime');
  // eslint-disable-next-line no-restricted-globals
  if (!quizStartTime || isNaN(quizStartTime)) {
    const currentTime = new Date().getTime();
    cookies.set('quizStartTime', currentTime);
  }

  const getQuestSlugWROActiveQuestion = (distance) => {
    const questionSlugs = get(quizDetails, 'questions', []);
    const index = questionSlugs.indexOf(activeQuestionSlug) + distance;
    return get(questionSlugs, index, null);
  };

  useEffect(() => {
    gemsUtils.checkEnableGems({
      teacherId: teacher_id,
      vcId: vc_id,
      classStartTime: class_start_time,
      isStudent: isStudent(),
      settings
    }).then((result) => {
      setIsGemsEnabled(result);
    });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line no-unused-expressions
    isUserLoggedIn && fetchQuizBySlug(quizSlug);
    const storageUserSubmissions = JSON.parse(get(localStorage, 'userSubmissions', '{}'));
    if (isEmpty(storageUserSubmissions) || (storageUserSubmissions.vcId !== vc_id)) {
      const defaultUserSubmissions = {
        vcId: vc_id,
        teacherId: teacher_id,
        quizzes: {
          [quizSlug]: {}
        },
      };
      localStorage.setItem('userSubmissions', JSON.stringify(defaultUserSubmissions));
    }
  }, [quizSlug]);

  useEffect(() => {
    const storageUserSubmissions = JSON.parse(get(localStorage, 'userSubmissions', '{}'));
    const userAnswers = get(storageUserSubmissions, 'quizzes', {})[quizSlug] || {};
    if (activeQuestionSlug) {
      if (!isEmpty(userAnswers[activeQuestionSlug])) {
        setIsCurrentQuestionSubmitted(true);
      }
      fetchQuestionsBySlugs([
        activeQuestionSlug,
        getQuestSlugWROActiveQuestion(1),
      ]);
    }
  }, [get(quiz, quizSlug)]);

  useEffect(() => {
    if (isCurrentQuestionSubmitted && !isEmpty(submittedQuizData)) {
      if (!isAlreadySubmittedQuiz) {
        updateVcQuizTrack(submittedQuizData).then(() => {
          const result = {
            score: get(submittedQuizData, 'score', 0),
            time_spent_in_ms: get(submittedQuizData, 'time_spent_in_ms', 0),
            is_completed: get(submittedQuizData, 'is_completed', false),
          };
          updateQuizState({
            [quizSlug]: {
              ...get(quiz, quizSlug),
              quizStep: 'result',
              savedQuizResult: result,
            },
          });
        });
      } else {
        const result = {
          score: get(submittedQuizData, 'score', 0),
          time_spent_in_ms: get(submittedQuizData, 'time_spent_in_ms', 0),
          is_completed: get(submittedQuizData, 'is_completed', false),
        };
        updateQuizState({
          [quizSlug]: {
            ...get(quiz, quizSlug),
            quizStep: 'result',
            savedQuizResult: result,
          },
        });
      }
    }
  }, [isCurrentQuestionSubmitted, submittedQuizData]);

  function handleNextSubQuestion() {
    const nextQuestionSlug = getQuestSlugWROActiveQuestion(1);
    if (nextQuestionSlug !== null) {
      fetchQuestionsBySlugs([
        getQuestSlugWROActiveQuestion(2),
        getQuestSlugWROActiveQuestion(3),
      ]);
      updateQuizState({
        [quizSlug]: {
          ...get(quiz, quizSlug),
          activeQuestionSlug: nextQuestionSlug,
        },
      });
    }
  }

  function handlePrevSubQuestion() {
    const prevQuestionSlug = getQuestSlugWROActiveQuestion(-1);
    fetchQuestionsBySlugs([
      getQuestSlugWROActiveQuestion(-2),
      getQuestSlugWROActiveQuestion(-3),
    ]);
    if (prevQuestionSlug !== null) {
      updateQuizState({
        [quizSlug]: {
          ...get(quiz, quizSlug),
          activeQuestionSlug: prevQuestionSlug,
        },
      });
    }
  }

  function handleSubmitSubQuestion(data) {
    const storageUserSubmissions = JSON.parse(get(localStorage, 'userSubmissions', '{}'));
    const updatedUserSubmissions = {
      ...storageUserSubmissions,
      quizzes: {
        ...storageUserSubmissions.quizzes,
        [quizDetails.slug]: data.updatedUserAnswers
      }
    };
    localStorage.setItem('userSubmissions', JSON.stringify(updatedUserSubmissions));
    setIsCurrentQuestionSubmitted(false);
    saveSubQuestion({ ...data, quizSlug }).then(() => {
      setIsCurrentQuestionSubmitted(true);
    });
  }

  const handleRedirectToResultPage = (quizResult) => {
    if (isEmpty(quizResult)) {
      Sentry.withScope((scope) => {
        scope.setTag('errorType', 'QuizComponentError');
        scope.setLevel('error');
        Sentry.captureException(new Error('Quiz Result empty in handleRedirectToResultPage'), {
          fingerprint: 'QuizComponentError'
        });
      });
      return;
    }
    setIsAlreadySubmittedQuiz(true);
    setSubmittedQuizData(quizResult);
  };

  const handleQuizSubmit = (quizResult) => {
    if (isEmpty(quizResult)) {
      Sentry.withScope((scope) => {
        scope.setTag('errorType', 'QuizComponentError');
        scope.setLevel('error');
        Sentry.captureException(new Error('Quiz Result empty in handleQuizSubmit'), {
          fingerprint: 'QuizComponentError'
        });
      });
      return;
    }
    setIsAlreadySubmittedQuiz(false);
    setSubmittedQuizData(quizResult);
    const storageUserSubmissions = JSON.parse(get(localStorage, 'userSubmissions', '{}'));
    const userAnswers = get(storageUserSubmissions, 'quizzes', {})[quizSlug] || {};
    const questions = [];
    const questionWiseAnswer = Object.keys(userAnswers).map((question) => {
      questions.push(question);
      return {
        question_id: question,
        is_correct: userAnswers[question].isCorrect,
      };
    });
    let totalGemsEarned = get(eventWiseGemsReward, 'VC_CLASS_QUESTION_CORRECT_REWARD.point', 20) * quizResult.correctQuestionsCount;
    const incorrectQuestionCount = get(quizDetails, 'questions', []).length - quizResult.correctQuestionsCount;
    const earnedGemsReasons = [{
      title: get(eventWiseGemsReward, 'VC_CLASS_QUESTION_CORRECT_REWARD.title', 'For Correct Answers'),
      count: (get(eventWiseGemsReward, 'VC_CLASS_QUESTION_CORRECT_REWARD.point', 20) * quizResult.correctQuestionsCount)
    }];
    if (quizResult.score < 1 && incorrectQuestionCount > 0) {
      earnedGemsReasons.push({
        title: get(eventWiseGemsReward, 'VC_CLASS_QUESTION_WRONG_REWARD.title', 'For Incorrect Answers'),
        count: (get(eventWiseGemsReward, 'VC_CLASS_QUESTION_WRONG_REWARD.point', 10) * incorrectQuestionCount)
      });
      totalGemsEarned += get(eventWiseGemsReward, 'VC_CLASS_QUESTION_WRONG_REWARD.point', 10) * incorrectQuestionCount;
    } else if (quizResult.score === 1) {
      totalGemsEarned += get(eventWiseGemsReward, 'VC_CLASS_QUIZ_PERFECT_SCORE_REWARD.points', 50);
      earnedGemsReasons.push({
        title: get(eventWiseGemsReward, 'VC_CLASS_QUIZ_PERFECT_SCORE_REWARD.title', 'For Perfect Score'),
        count: get(eventWiseGemsReward, 'VC_CLASS_QUIZ_PERFECT_SCORE_REWARD.point', 50)
      });
    }
    setTotalGems(totalGemsEarned);
    setGemsReasons(earnedGemsReasons);
    if (isGemsEnabled) {
      const eventData = {
        event_source_type: 'vc_class_quiz_completed',
        user_id: userId(),
        event_data: {
          vc_id,
          quiz_id: quizSlug,
          questions: questionWiseAnswer,
        },
        gems_data: {
          earned_gems: totalGemsEarned
        }
      };
      sentryUtil.sendLogs('Quiz submitted', {
        ...eventData,
        questions
      });
      la.sendEvent(eventData);
    }
  };

  const handleStartQuiz = () => {
    const currentTime = new Date().getTime();
    cookies.set('quizStartTime', currentTime);

    if (!trackId) {
      insertVcQuizTrack(quizSlug);
    } else {
      updateQuizState({
        [quizSlug]: {
          ...get(quiz, quizSlug),
          quizStep: 'question',
        },
      });
    }
  };

  if (!quizDetails && quiz[quizSlug]) {
    return <Redirect to={routes.FOUR_NOT_FOUR} />;
  }

  if (!quizDetails || !questionDetails) {
    return <Loader text="quiz" />;
  }

  const landingPageProps = {
    quizType: 'normal', // or revision // Todo - get this from setting / API
    enableGems: isGemsEnabled,
    scoresInPercent: {
      // Todo - do we need this here? get this from setting / API for revision
      correct: 80,
      incorrect: 20,
    },
    gemsDistribution: [
      {
        title: get(
          eventWiseGemsReward,
          'VC_CLASS_QUESTION_CORRECT_REWARD.title',
          'For Correct Answer'
        ),
        count: get(
          eventWiseGemsReward,
          'VC_CLASS_QUESTION_CORRECT_REWARD.points',
          20
        ),
      },
      {
        title: get(
          eventWiseGemsReward,
          'VC_CLASS_QUIZ_PERFECT_SCORE_REWARD.title',
          'For Perfeect Score'
        ),
        count: get(
          eventWiseGemsReward,
          'VC_CLASS_QUIZ_PERFECT_SCORE_REWARD.points',
          50
        ),
      }
    ],
    handleStartClick: handleStartQuiz,
    classes: {},
    quizTitle: get(quizDetails, 'name'),
    showElements: {
      header: true,
      backButton: false,
    },
    totalGems: 0, // Todo - will this always start from 0 or previous gems??
  };

  const userSubmissions = JSON.parse(get(localStorage, 'userSubmissions', '{}'));
  const storageUserAnswers = get(userSubmissions, 'quizzes', {})[quizDetails.slug];

  const quizProps = {
    ...quizSettings,
    enableGems: isGemsEnabled,
    quizStartTime,
    gemsAllocation: {
      correct: get(eventWiseGemsReward, 'VC_CLASS_QUESTION_CORRECT_REWARD.point', 20),
      incorrect: get(eventWiseGemsReward, 'VC_CLASS_QUESTION_WRONG_REWARD.point', 10),
    },
    submitButton: quizSettings.submitButton && !isQuestionSubmitted,
    quizSlug,
    quizDetails,
    storageUserAnswers,
    questionSlug: activeQuestionSlug,
    questionDetails,
    handleNextClick: handleNextSubQuestion,
    handleSkipClick: handleNextSubQuestion,
    handleBackClick: handlePrevSubQuestion,
    handleSubmitClick: handleQuizSubmit,
    handleRedirectToResultPage,
    handleIssueSubmitClick: createQuestionIssueTicket,
    handleCheckClick: handleSubmitSubQuestion,
  };

  const resultPageProps = {
    quizTitle: get(quizDetails, 'name'),
    showRetakeButton: false,
    role: isStudent() ? 'student' : 'teacher',
    scoresInPercent: {
      correct: submittedQuizData.score * 100,
      incorrect: 100 - submittedQuizData.score * 100,
    },
    passingScoreInPercent: passingMarks,
    enableGems: isGemsEnabled && !isAlreadySubmittedQuiz,
    handleRetakeQuizClick: handleStartQuiz,
    handleViewAnswersClick: handleStartQuiz,
    gemsReasons,
    previousGems: totalGemsFromAPI,
    earnedGems: totalGems,
  };
  if (quizStep === 'introduction') {
    return <QuizLandingPage {...landingPageProps} />;
  }

  if (quizStep === 'result') {
    return <QuizResultPage {...resultPageProps} />;
  }

  return <ExternalQuiz {...quizProps} />;
};

export default Quiz;
