pragma experimental ABIEncoderV2;

pragma solidity ^0.6.0;

contract loan {
    uint public principalAmount;
    string public loanID;

    struct Repayment {
        string date;
        uint amount;
    }
    Repayment[] public repayments;

    enum Status {ACTIVE,CLOSED,OVERDUE,DEFAULT}

    Status public status;

    constructor(uint principal, string memory Id) public {
        principalAmount = principal;
        loanID = Id;
        status = Status.ACTIVE;
    }

    event RepaymentEvent(
        uint256 amount,
        address contract_creator
    );

    function makeRepayment(
        string memory date,
        uint256 amount
        )
        public
        payable
        {
            repayments.push(Repayment({date: date,amount: amount}));
            emit RepaymentEvent(amount, address(this));
        }
        
    function getRepayments() public view returns (Repayment[] memory){
       return repayments;
    }
}