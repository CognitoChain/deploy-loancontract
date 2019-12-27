pragma solidity ^0.6.0;

contract loan {
    uint256 totalRepaid;
    uint256 principalAmount;
    uint256 TotalRepaymentDue;
    enum Status {
        ACTIVE,
        CLOSED,
        DEFAULT,
        DEACTIVATED
    }
    Status status;
    constructor(uint256 principal,uint256 totalDue  ) public {
        totalRepaid = 0;
        principalAmount = principal;
        TotalRepaymentDue = totalDue;
        status = Status.ACTIVE;
    }

    function getTotalRepaid() public view returns(uint256 ) {
        return totalRepaid;
    }

    event RepaymentEvent(
        uint256 amount,
        address contract_creator
    );
    function getStatus() public view returns (Status) {
        return status;
    }

    function makeRepayment(uint256 amount) public payable  returns (uint256 _totalRepaid) {
        require(TotalRepaymentDue > 0,'TotalRepaymentDue should be more than 0');
        require(status == Status.ACTIVE, 'Loan status should be Active for making payments');
        totalRepaid = totalRepaid + amount;
        emit RepaymentEvent(amount, address(this));
        if ( totalRepaid >= TotalRepaymentDue) {
                status = Status.CLOSED;
            }
        return totalRepaid;
    }

    function getRemainingbalance() public view returns (uint256 _totalDue) {
        require(TotalRepaymentDue > 0, 'TotalRepaymentDue should be more than 0');
        return (TotalRepaymentDue - totalRepaid);
    }
}